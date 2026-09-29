import { promises as fs } from "node:fs";
import path from "node:path";

import type { Game, RestoreManifestFile } from "@types";
import type { EmulatorCardPathOverride } from "./emulator-card-path-store.js";

import { duckstationConfigCandidates } from "../emulators/emulator-config.js";
import {
  buildMcsBuffer,
  listPs1Saves,
  readPs1SaveContents,
} from "../emulators/ps1-memory-card/index.js";
import {
  emulatorRestoreRule,
  emulatorSaveFileKey,
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

const CARD_PATH = /^<emulator>\/duckstation-card\/([A-Z]{4}-\d{5})\/(\d)$/;
const STATE_PATH = /^<emulator>\/duckstation-state\/([A-Z]{4}-\d{5})$/;
const stateName = (name: string, serial: string) =>
  new RegExp(`^${serial}_(?:\\d{1,2}|resume)\\.sav(?:\\.backup)?$`, "i").test(
    name
  );
const normalizeSerial = (serial: string) => serial.toUpperCase();

export type DuckstationSaveConfig = {
  iniPath: string;
  memcardsDir: string;
  statesDir: string;
  get: (group: string, key: string) => string | null;
};
type Config = DuckstationSaveConfig;

const configCandidates = (executablePath: string | null) => [
  ...(executablePath
    ? [path.join(path.dirname(executablePath), "settings.ini")]
    : []),
  ...(process.platform === "darwin"
    ? [
        path.join(
          homeDirectory(),
          "Library",
          "Application Support",
          "DuckStation",
          "settings.ini"
        ),
      ]
    : []),
  ...duckstationConfigCandidates(),
];

export const loadDuckstationSaveConfig = async (): Promise<Config | null> => {
  const { getEmulatorConfig } = await import(
    "../emulators/emulators-repository.js"
  );
  const emulator = await getEmulatorConfig("ps1");
  if (!emulator.executablePath) return null;
  const ini = await readFirstConfig(configCandidates(emulator.executablePath));
  if (!ini) return null;
  const root = path.dirname(ini.path);
  return {
    iniPath: ini.path,
    get: ini.get,
    memcardsDir: resolveConfiguredPath(
      root,
      ini.get("Folders", "MemoryCards") ?? ini.get("MemoryCards", "Directory"),
      "memcards"
    ),
    statesDir: resolveConfiguredPath(
      root,
      ini.get("Folders", "SaveStates"),
      "savestates"
    ),
  };
};

const loadConfig = loadDuckstationSaveConfig;

export const getDuckstationSaveEnvironmentKey = async (_game: Game) => {
  const config = await loadConfig().catch(() => null);
  const overrides = await readOverrides(_game);
  return config
    ? JSON.stringify([
        "duckstation-v2",
        config.iniPath,
        config.memcardsDir,
        config.statesDir,
        Array.from({ length: 8 }, (_, index) => [
          config.get("MemoryCards", `Card${index + 1}Type`),
          config.get("MemoryCards", `Card${index + 1}Path`),
        ]),
        overrides,
      ])
    : overrides.length
      ? JSON.stringify(["duckstation-config-unresolved", overrides])
      : "duckstation-config-unresolved";
};

const cardType = (config: Config, slot: number) =>
  config.get("MemoryCards", `Card${slot}Type`) ??
  (slot === 1 ? "PerGameTitle" : "None");

const allowedCardExtension = (name: string) =>
  /\.(?:mcd|mcr|mc|gme|vgs|vmp)$/i.test(name);

const readOverrides = async (
  game: Game
): Promise<EmulatorCardPathOverride[]> => {
  try {
    const { getEmulatorCardPathOverrides } = await import(
      "./emulator-card-path-store.js"
    );
    return await getEmulatorCardPathOverrides(game, "duckstation");
  } catch {
    return [];
  }
};

export const validateDuckstationManualCardForGame = async (
  game: Game,
  filePath: string
): Promise<boolean> => {
  if (
    serialsForGame(game).size === 0 ||
    !allowedCardExtension(filePath) ||
    !(await isRegularFile(filePath))
  )
    return false;
  // The user may bind a formatted destination card before restoring its saves.
  return (await listPs1Saves(filePath)) !== null;
};

const resolveCardPath = async (
  config: Config | null,
  slot: number,
  serial: string,
  overrides: ReadonlyMap<string, string> = new Map(),
  allowedSerials: ReadonlySet<string> = new Set([serial])
): Promise<string | null> => {
  const override = overrides.get(String(slot));
  if (override) return override;
  if (!config) return null;
  const type = cardType(config, slot).toLowerCase();
  if (type === "none" || type === "nonpersistent") return null;
  if (type === "shared") {
    return resolveConfiguredPath(
      config.memcardsDir,
      config.get("MemoryCards", `Card${slot}Path`),
      `shared_card_${slot}.mcd`
    );
  }
  if (type === "pergame") {
    return path.join(config.memcardsDir, `${serial}_${slot}.mcd`);
  }
  if (type !== "pergametitle" && type !== "pergamefiletitle") return null;
  // Title card names depend on DuckStation's game database. Bind only an
  // existing card whose contents identify exactly this game's serial.
  const entries = await fs
    .readdir(config.memcardsDir, { withFileTypes: true })
    .catch(() => []);
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !allowedCardExtension(entry.name)) continue;
    if (!new RegExp(`_${slot}\\.[^.]+$`, "i").test(entry.name)) continue;
    const candidate = path.join(config.memcardsDir, entry.name);
    const info = await listPs1Saves(candidate);
    if (!info) throw new Error("cloud_save_duckstation_card_unreadable");
    if (
      !info.saves.some((save) => normalizeSerial(save.sku ?? "") === serial)
    ) {
      continue;
    }
    if (
      info.saves.some(
        (save) => !save.sku || !allowedSerials.has(normalizeSerial(save.sku))
      )
    ) {
      throw new Error("cloud_save_duckstation_card_ambiguous");
    }
    matches.push(candidate);
  }
  if (matches.length > 1)
    throw new Error("cloud_save_duckstation_card_ambiguous");
  return matches[0] ?? null;
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
            emulatorId: "duckstation",
          },
        }
      : {}),
  });
};

export const parseDuckstationCardRawPath = (rawPath: string) => {
  const match = CARD_PATH.exec(rawPath);
  return match ? { serial: match[1], slot: Number(match[2]) } : null;
};

export const resolveDuckstationCardTarget = async (
  game: Game,
  file: RestoreManifestFile,
  options: {
    config?: DuckstationSaveConfig | null;
    overrides?: ReadonlyMap<string, string>;
  } = {}
) => {
  const parsed = parseDuckstationCardRawPath(file.rawPath);
  if (!parsed || !serialsForGame(game).has(parsed.serial)) return null;
  const config =
    options.config === undefined
      ? await loadConfig().catch(() => null)
      : options.config;
  const overrides =
    options.overrides ??
    new Map((await readOverrides(game)).map((item) => [item.slot, item.path]));
  const target = await resolveCardPath(
    config,
    parsed.slot,
    parsed.serial,
    overrides,
    serialsForGame(game)
  );
  if (!target || !(await isRegularFile(target))) return null;
  return target;
};

export const getDuckstationGameSaveFileFilter = async (game: Game) => {
  const serials = serialsForGame(game);
  const config = await loadConfig().catch(() => null);
  return async (filePath: string) => {
    if (!config || path.resolve(path.dirname(filePath)) !== config.statesDir)
      return false;
    return [...serials].some((serial) =>
      stateName(path.basename(filePath), serial)
    );
  };
};

export const scanDuckstationSaves = async (
  context: EmulatorProviderContext,
  config: DuckstationSaveConfig | null,
  overrides: ReadonlyMap<string, string> = new Map(),
  privateRoot?: string
): Promise<EmulatorProviderDiscovery> => {
  const result: EmulatorProviderDiscovery = {
    files: [],
    coverage: [],
    revision: "duckstation-v1",
  };
  const serials = serialsForGame(context.game);
  if (serials.size === 0) {
    result.coverage.push(
      unresolvedCoverage("duckstation", "duckstation-serial-unresolved")
    );
    return result;
  }
  for (const serial of serials) {
    for (let slot = 1; slot <= 8; slot += 1) {
      const type = config ? cardType(config, slot).toLowerCase() : "none";
      if (
        (type === "none" || type === "nonpersistent") &&
        !overrides.has(String(slot))
      )
        continue;
      const rawPath = `<emulator>/duckstation-card/${serial}/${slot}`;
      const card = await resolveCardPath(
        config,
        slot,
        serial,
        overrides,
        serials
      ).catch(() => undefined);
      if (card === undefined) {
        result.coverage.push(makeCoverage(rawPath, context.variantId, false));
        continue;
      }
      if (card === null) {
        result.coverage.push(makeCoverage(rawPath, context.variantId, false));
        continue;
      }
      if (!(await isRegularFile(card))) {
        result.coverage.push(makeCoverage(rawPath, context.variantId, false));
        continue;
      }
      const info = await listPs1Saves(card);
      if (!info) {
        result.coverage.push(makeCoverage(rawPath, context.variantId, false));
        continue;
      }
      let complete = true;
      for (const save of info.saves) {
        if (normalizeSerial(save.sku ?? "") !== serial) continue;
        const contents = await readPs1SaveContents(card, save.identifier);
        if (!contents) {
          complete = false;
          continue;
        }
        const name = `${sha256(save.identifier)}.mcs`;
        const exportPath = await exportedSavePath(
          context.game,
          "duckstation",
          `${serial}-${slot}`,
          name,
          privateRoot
        );
        await writeExport(exportPath, buildMcsBuffer(contents));
        addFile(
          result,
          context,
          rawPath,
          exportPath,
          name,
          "emulator:duckstation-card"
        );
      }
      result.coverage.push(makeCoverage(rawPath, context.variantId, complete));
    }
    const stateRawPath = `<emulator>/duckstation-state/${serial}`;
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
        "emulator:duckstation-state",
        true
      );
    }
    result.coverage.push(
      makeCoverage(stateRawPath, context.variantId, complete)
    );
  }
  return result;
};

export const duckstationSaveProvider: EmulatorProvider = {
  async discover(context) {
    const config = await loadConfig().catch(() => null);
    const overrides = new Map(
      (await readOverrides(context.game)).map((item) => [item.slot, item.path])
    );
    const discovery = await scanDuckstationSaves(context, config, overrides);
    if (!config) {
      discovery.coverage.push(
        unresolvedCoverage("duckstation", "duckstation-config-unresolved")
      );
    }
    return discovery;
  },
  async restoreRules(game, files) {
    const config = await loadConfig().catch(() => null);
    const serials = serialsForGame(game);
    const rules = new Map<string, ReturnType<typeof emulatorRestoreRule>>();
    for (const file of files) {
      const card = parseDuckstationCardRawPath(file.rawPath);
      if (
        card &&
        serials.has(card.serial) &&
        /^[a-f0-9]{64}\.mcs$/.test(file.relativePath)
      ) {
        const target = await resolveDuckstationCardTarget(game, file);
        if (!target) continue;
        const stage = await exportedSavePath(
          game,
          "duckstation-restore",
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
