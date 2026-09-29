import { promises as fs } from "node:fs";
import path from "node:path";

import type { Game, RestoreManifestFile } from "@types";
import type { EmulatorCardPathOverride } from "./emulator-card-path-store.js";

import { pcsx2ConfigCandidates } from "../emulators/emulator-config.js";
import {
  buildPsuBuffer,
  extractSkuFromSaveFolder,
  listSaves,
  readSaveContents,
} from "../emulators/ps2-memory-card/index.js";
import {
  emulatorRestoreRule,
  emulatorSaveFileKey,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
  EmulatorProviderDiscovery,
} from "./emulator-provider-types.js";
import {
  exportedSavePath,
  homeDirectory,
  isRegularFile,
  isSafeFilePath,
  isSafePrivateExportPath,
  makeCoverage,
  readFirstConfig,
  resolveConfiguredPath,
  serialsForGame,
  sha256,
  unresolvedCoverage,
  writeExport,
} from "./playstation-save-common.js";

const CARD_PATH =
  /^<emulator>\/pcsx2-card\/([A-Z]{4}-\d{5})\/(1|2|m[12]s[123])$/;
const FOLDER_PATH =
  /^<emulator>\/pcsx2-folder\/([A-Z]{4}-\d{5})\/(1|2|m[12]s[123])$/;
const STATE_PATH = /^<emulator>\/pcsx2-state\/([A-Z]{4}-\d{5})$/;
const stateName = (name: string, serial: string) =>
  new RegExp(
    `^${serial} \\([A-F0-9]{8}\\)\\.(?:resume|\\d{2})\\.p2s(?:\\.backup)?$`,
    "i"
  ).test(name);

export type Pcsx2SaveConfig = {
  iniPath: string;
  cardsDir: string;
  statesDir: string;
  get: (group: string, key: string) => string | null;
};
type Config = Pcsx2SaveConfig;

const configCandidates = (executablePath: string | null) => [
  ...(process.platform === "darwin"
    ? [
        path.join(
          homeDirectory(),
          "Library",
          "Application Support",
          "PCSX2",
          "inis",
          "PCSX2.ini"
        ),
      ]
    : []),
  ...pcsx2ConfigCandidates(executablePath),
];

export const loadPcsx2SaveConfig = async (): Promise<Config | null> => {
  const { getEmulatorConfig } = await import(
    "../emulators/emulators-repository.js"
  );
  const emulator = await getEmulatorConfig("ps2");
  if (!emulator.executablePath) return null;
  const ini = await readFirstConfig(configCandidates(emulator.executablePath));
  if (!ini) return null;
  const root = path.dirname(path.dirname(ini.path));
  return {
    iniPath: ini.path,
    get: ini.get,
    cardsDir: resolveConfiguredPath(
      root,
      ini.get("Folders", "MemoryCards"),
      "memcards"
    ),
    statesDir: resolveConfiguredPath(
      root,
      ini.get("Folders", "Savestates"),
      "sstates"
    ),
  };
};

const loadConfig = loadPcsx2SaveConfig;

const slots = [
  "1",
  "2",
  "m1s1",
  "m1s2",
  "m1s3",
  "m2s1",
  "m2s2",
  "m2s3",
] as const;

const slotKey = (slot: string) => {
  const multitap = /^m([12])s([123])$/.exec(slot);
  return multitap ? `Multitap${multitap[1]}_Slot${multitap[2]}` : `Slot${slot}`;
};

const slotEnabled = (config: Config, slot: string) => {
  const value = config.get("MemoryCards", `${slotKey(slot)}_Enable`);
  return value ? /^(?:true|1|yes)$/i.test(value) : slot === "1" || slot === "2";
};

const cardPath = (
  config: Config | null,
  slot: string,
  overrides: ReadonlyMap<string, string> = new Map()
) => {
  const override = overrides.get(slot);
  if (override) return override;
  if (!config) return null;
  if (!slotEnabled(config, slot)) return null;
  const configuredName = config.get("MemoryCards", `${slotKey(slot)}_Filename`);
  if (!configuredName && slot !== "1" && slot !== "2") return null;
  return resolveConfiguredPath(
    config.cardsDir,
    configuredName,
    slot === "1" ? "Mcd001.ps2" : slot === "2" ? "Mcd002.ps2" : ""
  );
};

const readOverrides = async (
  game: Game
): Promise<EmulatorCardPathOverride[]> => {
  try {
    const { getEmulatorCardPathOverrides } = await import(
      "./emulator-card-path-store.js"
    );
    return await getEmulatorCardPathOverrides(game, "pcsx2");
  } catch {
    return [];
  }
};

export const validatePcsx2ManualCardForGame = async (
  game: Game,
  filePath: string
): Promise<boolean> => {
  const stat = await fs.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return false;
  if (serialsForGame(game).size === 0) return false;
  if (stat.isDirectory()) {
    // A formatted folder card can be selected before this game's save exists.
    return isRegularFile(path.join(filePath, "_pcsx2_superblock"));
  }
  if (!stat.isFile() || !/\.(?:ps2|mcd|mc2)$/i.test(filePath)) return false;
  return (await listSaves(filePath)) !== null;
};

export const getPcsx2SaveEnvironmentKey = async (_game: Game) => {
  const config = await loadConfig().catch(() => null);
  const overrides = await readOverrides(_game);
  return config
    ? JSON.stringify([
        "pcsx2-v2",
        config.iniPath,
        config.cardsDir,
        config.statesDir,
        slots.map((slot) => [slot, cardPath(config, slot)]),
        overrides,
      ])
    : overrides.length
      ? JSON.stringify(["pcsx2-config-unresolved", overrides])
      : "pcsx2-config-unresolved";
};

const addFile = (
  result: EmulatorProviderDiscovery,
  context: EmulatorProviderContext,
  rawPath: string,
  absolutePath: string,
  relativePath: string,
  provenance: string,
  state = false
) => {
  const root = path.dirname(absolutePath);
  result.files.push({
    variantId: context.variantId,
    ruleId: sha256(JSON.stringify(["emulator", rawPath])),
    rawPath,
    absolutePath,
    relativePath,
    localBindings: {
      environmentId: context.environmentId,
      rootId: sha256(JSON.stringify([context.environmentId, root])),
      concreteUserSegment: "__default__",
      concretePath: root,
    },
    confidence: "exact",
    provenance: [provenance],
    ...(state
      ? {
          stateMetadata: {
            emulatorId: "pcsx2",
          },
        }
      : {}),
  });
};

const walkSaveFolder = async (root: string) => {
  const files: string[] = [];
  let complete = true;
  const walk = async (directory: string) => {
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => null);
    if (!entries) {
      complete = false;
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        complete = false;
      } else if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      } else {
        complete = false;
      }
    }
  };
  await walk(root);
  return { files, complete };
};

const parseCard = (rawPath: string) => {
  const match = CARD_PATH.exec(rawPath);
  return match ? { serial: match[1], slot: match[2] } : null;
};

const parseFolder = (rawPath: string) => {
  const match = FOLDER_PATH.exec(rawPath);
  return match ? { serial: match[1], slot: match[2] } : null;
};

export const isPcsx2CardRawPath = (rawPath: string) =>
  Boolean(parseCard(rawPath));

export const resolvePcsx2CardTarget = async (
  game: Game,
  file: RestoreManifestFile,
  options: {
    config?: Pcsx2SaveConfig | null;
    overrides?: ReadonlyMap<string, string>;
  } = {}
) => {
  const parsed = parseCard(file.rawPath);
  if (!parsed || !serialsForGame(game).has(parsed.serial)) return null;
  const config =
    options.config === undefined
      ? await loadConfig().catch(() => null)
      : options.config;
  const overrides =
    options.overrides ??
    new Map((await readOverrides(game)).map((item) => [item.slot, item.path]));
  const target = cardPath(config, parsed.slot, overrides);
  if (!target || !(await isRegularFile(target))) return null;
  return target;
};

export const getPcsx2GameSaveFileFilter = async (game: Game) => {
  const serials = serialsForGame(game);
  const config = await loadConfig().catch(() => null);
  const overrides = new Map(
    (await readOverrides(game)).map((item) => [item.slot, item.path])
  );
  const folderCards = new Set<string>();
  if (config) {
    for (const slot of slots) {
      const target = cardPath(config, slot, overrides);
      if (target && (await fs.lstat(target).catch(() => null))?.isDirectory()) {
        folderCards.add(path.resolve(target));
      }
    }
  }
  return async (filePath: string) => {
    if (!config) return false;
    if (
      path.resolve(path.dirname(filePath)) === config.statesDir &&
      [...serials].some((serial) => stateName(path.basename(filePath), serial))
    ) {
      return true;
    }
    for (const root of folderCards) {
      const relative = path.relative(root, filePath).split(path.sep);
      if (
        relative.length > 1 &&
        safeRelativeSegments(relative.join("/")) &&
        serials.has(extractSkuFromSaveFolder(relative[0]) ?? "")
      ) {
        return true;
      }
    }
    return false;
  };
};

export const scanPcsx2Saves = async (
  context: EmulatorProviderContext,
  config: Pcsx2SaveConfig | null,
  overrides: ReadonlyMap<string, string> = new Map(),
  privateRoot?: string
): Promise<EmulatorProviderDiscovery> => {
  const result: EmulatorProviderDiscovery = {
    files: [],
    coverage: [],
    revision: "pcsx2-v1",
  };
  const serials = serialsForGame(context.game);
  if (serials.size === 0) {
    result.coverage.push(
      unresolvedCoverage("pcsx2", "pcsx2-serial-unresolved")
    );
    return result;
  }
  for (const serial of serials) {
    for (const slot of slots) {
      const target = cardPath(config, slot, overrides);
      if (!target) continue;
      const stat = await fs.lstat(target).catch(() => null);
      const imageRawPath = `<emulator>/pcsx2-card/${serial}/${slot}`;
      const folderRawPath = `<emulator>/pcsx2-folder/${serial}/${slot}`;
      if (stat?.isSymbolicLink()) {
        result.coverage.push(
          makeCoverage(imageRawPath, context.variantId, false)
        );
        result.coverage.push(
          makeCoverage(folderRawPath, context.variantId, false)
        );
        continue;
      }
      if (stat?.isDirectory()) {
        const rawPath = folderRawPath;
        const entries = await fs
          .readdir(target, { withFileTypes: true })
          .catch(() => null);
        let complete =
          Boolean(entries) &&
          (await isRegularFile(path.join(target, "_pcsx2_superblock")));
        for (const entry of entries ?? []) {
          if (extractSkuFromSaveFolder(entry.name) !== serial) continue;
          if (!entry.isDirectory() || entry.isSymbolicLink()) {
            complete = false;
            continue;
          }
          const scanned = await walkSaveFolder(path.join(target, entry.name));
          complete &&= scanned.complete;
          for (const absolute of scanned.files) {
            const relative = path
              .relative(target, absolute)
              .split(path.sep)
              .join("/");
            if (!safeRelativeSegments(relative)) {
              complete = false;
              continue;
            }
            addFile(
              result,
              context,
              rawPath,
              absolute,
              relative,
              "emulator:pcsx2-folder"
            );
          }
        }
        result.coverage.push(
          makeCoverage(rawPath, context.variantId, complete)
        );
      } else {
        const rawPath = imageRawPath;
        if (!stat) {
          result.coverage.push(makeCoverage(rawPath, context.variantId, false));
          result.coverage.push(
            makeCoverage(folderRawPath, context.variantId, false)
          );
          continue;
        }
        const info = await listSaves(target);
        if (!info) {
          result.coverage.push(makeCoverage(rawPath, context.variantId, false));
          continue;
        }
        let complete = true;
        for (const save of info.saves) {
          if (save.sku !== serial) continue;
          const contents = await readSaveContents(target, save.folderName);
          if (!contents) {
            complete = false;
            continue;
          }
          const name = `${sha256(save.folderName)}.psu`;
          const exportPath = await exportedSavePath(
            context.game,
            "pcsx2",
            `${serial}-${slot}`,
            name,
            privateRoot
          );
          await writeExport(exportPath, buildPsuBuffer(contents));
          addFile(
            result,
            context,
            rawPath,
            exportPath,
            name,
            "emulator:pcsx2-card"
          );
        }
        result.coverage.push(
          makeCoverage(rawPath, context.variantId, complete)
        );
      }
    }
    const stateRawPath = `<emulator>/pcsx2-state/${serial}`;
    if (!config) continue;
    const entries = await fs
      .readdir(config.statesDir, { withFileTypes: true })
      .catch(() => null);
    if (!entries) {
      result.coverage.push(
        makeCoverage(stateRawPath, context.variantId, false)
      );
      continue;
    }
    let complete = true;
    for (const entry of entries) {
      if (!stateName(entry.name, serial)) continue;
      const target = path.join(config.statesDir, entry.name);
      if (!entry.isFile() || !(await isRegularFile(target))) {
        complete = false;
        continue;
      }
      addFile(
        result,
        context,
        stateRawPath,
        target,
        entry.name,
        "emulator:pcsx2-state",
        true
      );
    }
    result.coverage.push(
      makeCoverage(stateRawPath, context.variantId, complete)
    );
  }
  return result;
};

export const pcsx2SaveProvider: EmulatorProvider = {
  async discover(context) {
    const config = await loadConfig().catch(() => null);
    const overrides = new Map(
      (await readOverrides(context.game)).map((item) => [item.slot, item.path])
    );
    const discovery = await scanPcsx2Saves(context, config, overrides);
    if (!config) {
      discovery.coverage.push(
        unresolvedCoverage("pcsx2", "pcsx2-config-unresolved")
      );
    }
    return discovery;
  },
  async restoreRules(game, files) {
    const config = await loadConfig().catch(() => null);
    const overrides = new Map(
      (await readOverrides(game)).map((item) => [item.slot, item.path])
    );
    const serials = serialsForGame(game);
    const rules = new Map<string, ReturnType<typeof emulatorRestoreRule>>();
    for (const file of files) {
      const card = parseCard(file.rawPath);
      if (
        card &&
        serials.has(card.serial) &&
        /^[a-f0-9]{64}\.psu$/.test(file.relativePath)
      ) {
        const target = await resolvePcsx2CardTarget(game, file);
        if (!target) continue;
        const stage = await exportedSavePath(
          game,
          "pcsx2-restore",
          `${card.serial}-${card.slot}`,
          file.relativePath
        );
        if (!(await isSafePrivateExportPath(stage))) continue;
        rules.set(
          emulatorSaveFileKey(file),
          emulatorRestoreRule(file.rawPath, stage, "file")
        );
        continue;
      }
      const folder = parseFolder(file.rawPath);
      if (folder && serials.has(folder.serial)) {
        const target = cardPath(config, folder.slot, overrides);
        const segments = safeRelativeSegments(file.relativePath);
        const stat = target ? await fs.lstat(target).catch(() => null) : null;
        if (
          !target ||
          !stat?.isDirectory() ||
          stat.isSymbolicLink() ||
          !segments ||
          segments.length < 2 ||
          extractSkuFromSaveFolder(segments[0]) !== folder.serial ||
          !(await isSafeFilePath(target, file.relativePath))
        ) {
          continue;
        }
        rules.set(
          emulatorSaveFileKey(file),
          emulatorRestoreRule(file.rawPath, target, "dir")
        );
        continue;
      }
      const state = STATE_PATH.exec(file.rawPath);
      if (
        !config ||
        !state ||
        !serials.has(state[1]) ||
        !stateName(file.relativePath, state[1]) ||
        !(await isSafeFilePath(config.statesDir, file.relativePath))
      ) {
        continue;
      }
      rules.set(
        emulatorSaveFileKey(file),
        emulatorRestoreRule(
          file.rawPath,
          path.join(config.statesDir, file.relativePath),
          "file"
        )
      );
    }
    return rules;
  },
};
