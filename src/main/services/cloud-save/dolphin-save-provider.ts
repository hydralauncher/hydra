import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CloudSaveRule, Game, RestoreManifestFile } from "@types";

import { dolphinUserDirectoryCandidates } from "../emulators/emulator-log-paths.js";
import {
  emulatorRestoreRule,
  emulatorSaveFileKey,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import {
  emulatorCoverage,
  emulatorPathHash,
  emulatorRuleId,
  emulatorUnresolvedCoverage,
  listSafeFiles,
  lstatIfExists,
  readDirectoryIfExists,
  safeRestorePath,
} from "./emulator-provider-fs.js";
import {
  canonicalizeDolphinGci,
  dolphinRawCardPath,
  extractDolphinRawCardGame,
  parseDolphinRawCardPath,
  readDolphinRawCard,
  validateDolphinManualRawCard,
} from "./dolphin-raw-card.js";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
  EmulatorProviderDiscovery,
} from "./emulator-provider-types.js";

const GAME_ID = /^[A-Z0-9]{6}$/;
const GCI_PATH = /^<emulator>\/dolphin-gci\/([AB])\/([A-Z0-9]{6})$/;
const WII_PATH = /^<emulator>\/dolphin-wii\/([a-f0-9]{16})$/;
const STATE_PATH = /^<emulator>\/dolphin-state\/([A-Z0-9]{6})$/;
const REGIONS = ["USA", "JAP", "JPN", "EUR", "DEV"] as const;
let exportCacheRootPromise: Promise<string> | null = null;

const writeExportCacheFile = async (segments: string[], content: Buffer) => {
  exportCacheRootPromise ??= fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-dolphin-save-export-")
  );
  const root = await exportCacheRootPromise;
  const target = path.join(root, ...segments);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  return target;
};

export { validateDolphinManualRawCard };

export const gameIds = (game: Game) => [
  ...new Set(
    (game.discs ?? [])
      .map((disc) => disc.sku?.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
      .filter((id): id is string => !!id && GAME_ID.test(id))
  ),
];

const isWii = (game: Game) => /\bwii\b/i.test(game.platform ?? "");

const regionForGame = (gameId: string) => {
  const code = gameId[3];
  if (code === "E" || code === "N") return "USA";
  if (code === "J") return "JAP";
  if ("PDFHIXSUY".includes(code)) return "EUR";
  return null;
};

const titleIdForWiiGame = (gameId: string) =>
  `00010000${Buffer.from(gameId.slice(0, 4), "ascii").toString("hex")}`;

const parseIni = (content: string) => {
  const values = new Map<string, string>();
  let section = "";
  for (const line of content.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      continue;
    }
    const pair = /^\s*([^=;#]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (!pair) continue;
    values.set(
      `${section}.${pair[1].trim().toLowerCase()}`,
      pair[2].replace(/^(['"])(.*)\1$/, "$2").trim()
    );
  }
  return (group: string, key: string) =>
    values.get(`${group.toLowerCase()}.${key.toLowerCase()}`) ?? null;
};

type DolphinLocation = {
  userDir: string;
  configPath: string | null;
  get: ReturnType<typeof parseIni>;
};

const withGameSettings = async (location: DolphinLocation, gameId: string) => {
  const configPath = path.join(
    location.userDir,
    "GameSettings",
    `${gameId}.ini`
  );
  const stat = await lstatIfExists(configPath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return location;
  const gameGet = parseIni(await fs.readFile(configPath, "utf8"));
  return {
    ...location,
    get: (group: string, key: string) =>
      gameGet(group, key) ?? location.get(group, key),
  };
};

const configuredPath = (userDir: string, value: string) => {
  const expanded =
    value === "~"
      ? os.homedir()
      : value.startsWith("~/")
        ? path.join(os.homedir(), value.slice(2))
        : value;
  return path.isAbsolute(expanded) ? expanded : path.resolve(userDir, expanded);
};

export const resolveDolphinSaveLocation =
  async (): Promise<DolphinLocation> => {
    const { getEmulatorConfig } = await import(
      "../emulators/emulators-repository.js"
    );
    const emulator = await getEmulatorConfig("dolphin");
    if (!emulator.executablePath)
      throw new Error("cloud_save_dolphin_not_configured");
    for (const userDir of dolphinUserDirectoryCandidates(
      emulator.executablePath
    )) {
      const configPath = path.join(userDir, "Config", "Dolphin.ini");
      const stat = await lstatIfExists(configPath).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) {
        return {
          userDir,
          configPath,
          get: parseIni(await fs.readFile(configPath, "utf8")),
        };
      }
    }
    for (const userDir of dolphinUserDirectoryCandidates(
      emulator.executablePath
    )) {
      const stat = await lstatIfExists(userDir).catch(() => null);
      if (stat?.isDirectory() && !stat.isSymbolicLink()) {
        return { userDir, configPath: null, get: parseIni("") };
      }
    }
    throw new Error("cloud_save_dolphin_user_directory_unresolved");
  };

const slotMode = (location: DolphinLocation, slot: "A" | "B") => {
  const value = location.get("Core", `Slot${slot}`);
  return value === null
    ? slot === "A"
      ? "gci"
      : "none"
    : value === "8"
      ? "gci"
      : value === "1"
        ? "raw"
        : "none";
};

const replaceRegionInPath = (value: string, region: string) => {
  const last = path.basename(value);
  return REGIONS.includes(last as (typeof REGIONS)[number])
    ? path.join(path.dirname(value), region)
    : path.join(value, region);
};

const configuredGciRoot = (location: DolphinLocation, slot: "A" | "B") => {
  const custom =
    location.get("Core", `GCIFolder${slot}PathOverride`) ??
    location.get("Core", `GCIFolder${slot}Path`);
  return custom ? configuredPath(location.userDir, custom) : null;
};

const gciRoot = (
  location: DolphinLocation,
  slot: "A" | "B",
  region: string
) => {
  const custom = configuredGciRoot(location, slot);
  if (!custom) return path.join(location.userDir, "GC", region, `Card ${slot}`);
  return replaceRegionInPath(custom, region === "JAP" ? "JPN" : region);
};

export const dolphinSlotEnvironmentSignature = (
  location: DolphinLocation,
  slot: "A" | "B"
) => [
  slot,
  slotMode(location, slot),
  location.get("Core", `GCIFolder${slot}PathOverride`),
  location.get("Core", `GCIFolder${slot}Path`),
  location.get("Core", `Memcard${slot}Path`),
];

const rawCardCandidates = async (
  location: DolphinLocation,
  slot: "A" | "B",
  region: string
) => {
  const custom = location.get("Core", `Memcard${slot}Path`);
  if (custom) {
    const resolved = configuredPath(location.userDir, custom);
    const ext = path.extname(resolved);
    if (!/\.(?:raw|gcp)$/i.test(ext)) return [];
    const stem = resolved
      .slice(0, -ext.length)
      .replace(/\.(?:USA|JAP|JPN|EUR|DEV)$/i, "");
    return [`${stem}.${region}${ext}`];
  }
  const gc = path.join(location.userDir, "GC");
  const entries = await readDirectoryIfExists(gc).catch(() => null);
  return (entries ?? [])
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        new RegExp(
          `^MemoryCard${slot}\\.${region}(?:\\.\\d+)?\\.(?:raw|gcp)$`,
          "i"
        ).test(entry.name)
    )
    .map((entry) => path.join(gc, entry.name));
};

const readGci = async (filePath: string) => {
  const stat = await lstatIfExists(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 0x40) return null;
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(0x40);
    const { bytesRead } = await handle.read(header, 0, 0x40, 0);
    if (bytesRead !== 0x40) return null;
    const id = header.subarray(0, 6).toString("ascii").toUpperCase();
    const blocks = header.readUInt16BE(0x38);
    return GAME_ID.test(id) &&
      blocks > 0 &&
      stat.size === 0x40 + blocks * 0x2000
      ? id
      : null;
  } finally {
    await handle.close();
  }
};

const readDolphinStateIdentity = async (filePath: string) => {
  const stat = await lstatIfExists(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 24) return null;
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(Math.min(stat.size, 160));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 24) return null;
    const gameId = header.subarray(0, 6).toString("ascii").toUpperCase();
    if (!GAME_ID.test(gameId)) return null;
    const legacyLzoSize = header.readUInt32LE(8);
    if (legacyLzoSize !== 0 || bytesRead < 32)
      return { gameId, version: undefined };
    const versionLength = header.readUInt32LE(28);
    const version =
      versionLength > 0 &&
      versionLength <= 64 &&
      bytesRead >= 32 + versionLength
        ? header.subarray(32, 32 + versionLength).toString("ascii")
        : null;
    return {
      gameId,
      version: version && /^[\x20-\x7e]+$/.test(version) ? version : undefined,
    };
  } finally {
    await handle.close();
  }
};

export const validateDolphinDownloadedFile = async (
  file: RestoreManifestFile,
  downloadedPath: string
) => {
  const gci = GCI_PATH.exec(file.rawPath);
  if (gci) return (await readGci(downloadedPath)) === gci[2];
  const state = STATE_PATH.exec(file.rawPath);
  if (state) {
    if (file.relativePath.endsWith(".dtm")) return true;
    const identity = await readDolphinStateIdentity(downloadedPath);
    return identity?.gameId === state[1];
  }
  return true;
};

export const validateDolphinGciRestoreFile = validateDolphinDownloadedFile;

const readWiiTitleGameId = async (titleRoot: string, titleId: string) => {
  const tmdPath = path.join(titleRoot, "content", "title.tmd");
  const stat = await lstatIfExists(tmdPath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  const tmd = await fs.readFile(tmdPath).catch(() => null);
  if (
    !tmd ||
    tmd.length < 0x19a ||
    tmd.subarray(0x18c, 0x194).toString("hex") !== titleId
  )
    return null;
  const suffix = tmd.subarray(0x198, 0x19a).toString("ascii").toUpperCase();
  const code = Buffer.from(titleId.slice(8), "hex")
    .toString("ascii")
    .toUpperCase();
  const id = `${code}${suffix}`;
  return GAME_ID.test(id) ? id : null;
};

const wiiTitleCanReceiveRestore = async (
  titleRoot: string,
  titleId: string,
  gameId: string
) => {
  const tmdPath = path.join(titleRoot, "content", "title.tmd");
  const tmdStat = await lstatIfExists(tmdPath).catch(() => undefined);
  if (tmdStat === undefined) return false;
  if (tmdStat) return (await readWiiTitleGameId(titleRoot, titleId)) === gameId;

  // A new host can receive this game's save before Dolphin has installed its
  // title metadata. Existing unbound data could belong to another publisher.
  const titleStat = await lstatIfExists(titleRoot).catch(() => undefined);
  if (titleStat === undefined) return false;
  if (!titleStat) return true;
  if (!titleStat.isDirectory() || titleStat.isSymbolicLink()) return false;
  const scan = await listSafeFiles(titleRoot);
  return scan.complete && scan.files.length === 0;
};

const addFile = (
  result: EmulatorProviderDiscovery,
  context: EmulatorProviderContext,
  rawPath: string,
  absolutePath: string,
  relativePath: string,
  root: string,
  stateVersion?: string | null
) => {
  result.files.push({
    variantId: context.variantId,
    ruleId: emulatorRuleId(rawPath),
    rawPath,
    absolutePath,
    relativePath,
    localBindings: {
      environmentId: context.environmentId,
      rootId: emulatorPathHash(JSON.stringify([context.environmentId, root])),
      concreteUserSegment: "__default__",
      concretePath: root,
    },
    confidence: "exact",
    provenance: ["emulator:dolphin"],
    ...(stateVersion !== undefined
      ? {
          stateMetadata: {
            emulatorId: "dolphin",
            ...(stateVersion ? { version: stateVersion } : {}),
          },
        }
      : {}),
  });
};

export const discoverDolphinRawCard = async (
  context: EmulatorProviderContext,
  cardPath: string,
  slot: "A" | "B",
  gameId: string
): Promise<Pick<EmulatorProviderDiscovery, "files" | "coverage">> => {
  const result: EmulatorProviderDiscovery = {
    files: [],
    coverage: [],
    revision: "dolphin-v1",
  };
  const rawPath = dolphinRawCardPath(slot, gameId);
  try {
    const card = await readDolphinRawCard(cardPath);
    const exports = extractDolphinRawCardGame(card, gameId);
    for (const file of exports.filter((item) => item.portable)) {
      const absolutePath = await writeExportCacheFile(
        ["raw", emulatorPathHash(cardPath), slot, gameId, file.fileName],
        file.buffer
      );
      addFile(result, context, rawPath, absolutePath, file.fileName, cardPath);
    }
    result.coverage.push(
      emulatorCoverage(
        rawPath,
        context.variantId,
        !exports.some((file) => !file.portable),
        "dolphin-raw-card-nonportable-save"
      )
    );
  } catch {
    result.coverage.push(
      emulatorCoverage(
        rawPath,
        context.variantId,
        false,
        "dolphin-raw-card-partial"
      )
    );
  }
  return result;
};

export const scanDolphinSaveRoot = async (
  context: EmulatorProviderContext,
  location: DolphinLocation | null,
  manualCards: { path: string; slot: string }[] = []
): Promise<EmulatorProviderDiscovery> => {
  const result: EmulatorProviderDiscovery = {
    files: [],
    coverage: [],
    revision: "dolphin-v1",
  };
  const ids = gameIds(context.game);
  if (!ids.length) {
    result.coverage.push(
      emulatorUnresolvedCoverage("dolphin", "dolphin-game-id-unresolved")
    );
    return result;
  }
  if (!location) {
    for (const id of ids) {
      for (const slot of ["A", "B"] as const) {
        const manual = manualCards.find((item) => item.slot === slot);
        if (!manual) continue;
        const discovered = await discoverDolphinRawCard(
          context,
          manual.path,
          slot,
          id
        );
        result.files.push(...discovered.files);
        result.coverage.push(...discovered.coverage);
      }
    }
    result.coverage.push(
      emulatorUnresolvedCoverage("dolphin", "dolphin-user-directory-unresolved")
    );
    return result;
  }
  for (const id of ids) {
    const gameLocation = await withGameSettings(location, id).catch(
      () => location
    );
    const statePath = `<emulator>/dolphin-state/${id}`;
    const stateRoot = path.join(location.userDir, "StateSaves");
    const states = await readDirectoryIfExists(stateRoot).catch(
      () => undefined
    );
    const stateNames = new Set(states?.map((entry) => entry.name) ?? []);
    let stateComplete = states != null;
    for (const entry of states ?? []) {
      if (!entry.name.startsWith(`${id}.`)) continue;
      const companion = entry.name.endsWith(".dtm");
      const primaryName = companion ? entry.name.slice(0, -4) : entry.name;
      if (
        !new RegExp(`^${id}\\.s\\d{2}$`, "i").test(primaryName) ||
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        (companion && !stateNames.has(primaryName))
      ) {
        stateComplete = false;
        continue;
      }
      const absolutePath = path.join(stateRoot, entry.name);
      const state = await readDolphinStateIdentity(
        path.join(stateRoot, primaryName)
      ).catch(() => null);
      if (state?.gameId !== id) {
        stateComplete = false;
        continue;
      }
      addFile(
        result,
        context,
        statePath,
        absolutePath,
        entry.name,
        stateRoot,
        state.version ?? null
      );
    }
    result.coverage.push(
      emulatorCoverage(
        statePath,
        context.variantId,
        stateComplete,
        "dolphin-state-partial"
      )
    );

    if (isWii(context.game)) {
      const titleId = titleIdForWiiGame(id);
      const nand = gameLocation.get("General", "NANDRootPath");
      const wiiRoot = nand
        ? configuredPath(gameLocation.userDir, nand)
        : path.join(location.userDir, "Wii");
      const titleRoot = path.join(
        wiiRoot,
        "title",
        "00010000",
        titleId.slice(8)
      );
      const dataRoot = path.join(titleRoot, "data");
      const rawPath = `<emulator>/dolphin-wii/${titleId}`;
      const actualId = await readWiiTitleGameId(titleRoot, titleId);
      const scan = actualId === id ? await listSafeFiles(dataRoot) : null;
      if (scan) {
        for (const absolutePath of scan.files) {
          const relativePath = path
            .relative(dataRoot, absolutePath)
            .split(path.sep)
            .join("/");
          if (safeRelativeSegments(relativePath)) {
            addFile(
              result,
              context,
              rawPath,
              absolutePath,
              relativePath,
              dataRoot
            );
          }
        }
      }
      result.coverage.push(
        emulatorCoverage(
          rawPath,
          context.variantId,
          actualId === id && !!scan?.complete,
          "dolphin-wii-title-identity-unresolved"
        )
      );
      continue;
    }

    const region = regionForGame(id);
    for (const slot of ["A", "B"] as const) {
      const gciPath = `<emulator>/dolphin-gci/${slot}/${id}`;
      const rawPath = dolphinRawCardPath(slot, id);
      const mode = slotMode(gameLocation, slot);
      const manual = manualCards.find((item) => item.slot === slot);
      if (manual) {
        const discovered = await discoverDolphinRawCard(
          context,
          manual.path,
          slot,
          id
        );
        result.files.push(...discovered.files);
        result.coverage.push(...discovered.coverage);
        continue;
      }
      if (!region) {
        result.coverage.push(
          emulatorCoverage(
            mode === "raw" ? rawPath : gciPath,
            context.variantId,
            false,
            "dolphin-region-unresolved"
          )
        );
        continue;
      }
      if (mode === "gci") {
        const root = gciRoot(gameLocation, slot, region);
        const entries = await readDirectoryIfExists(root).catch(
          () => undefined
        );
        let complete = entries != null;
        for (const entry of entries ?? []) {
          if (!/\.gci$/i.test(entry.name)) continue;
          if (!entry.isFile() || entry.isSymbolicLink()) {
            complete = false;
            continue;
          }
          const absolutePath = path.join(root, entry.name);
          const actualId = await readGci(absolutePath).catch(() => null);
          if (actualId === id) {
            try {
              const canonical = canonicalizeDolphinGci(
                await fs.readFile(absolutePath)
              );
              const cachedPath = await writeExportCacheFile(
                ["gci", emulatorPathHash(root), slot, id, entry.name],
                canonical
              );
              addFile(result, context, gciPath, cachedPath, entry.name, root);
            } catch {
              complete = false;
            }
          } else if (!actualId) complete = false;
        }
        result.coverage.push(
          emulatorCoverage(
            gciPath,
            context.variantId,
            complete,
            "dolphin-gci-partial"
          )
        );
      } else if (mode === "raw") {
        const candidates = await rawCardCandidates(gameLocation, slot, region);
        const existing: string[] = [];
        for (const candidate of candidates) {
          if (await lstatIfExists(candidate).catch(() => null))
            existing.push(candidate);
        }
        if (existing.length !== 1) {
          result.coverage.push(
            emulatorCoverage(
              rawPath,
              context.variantId,
              false,
              existing.length === 0
                ? "dolphin-raw-card-missing"
                : "dolphin-raw-card-ambiguous"
            )
          );
        } else {
          const discovered = await discoverDolphinRawCard(
            context,
            existing[0],
            slot,
            id
          );
          result.files.push(...discovered.files);
          result.coverage.push(...discovered.coverage);
        }
      }
    }
  }
  return result;
};

export const getDolphinSaveEnvironmentKey = async (game: Game) => {
  const location = await resolveDolphinSaveLocation().catch(() => null);
  const { getEmulatorCardPathOverrides } = await import(
    "./emulator-card-path-store.js"
  );
  const overrides = await getEmulatorCardPathOverrides(game, "dolphin").catch(
    () => []
  );
  const ids = gameIds(game);
  const gameSettings = location
    ? await Promise.all(
        ids.map(async (id) => {
          const filePath = path.join(
            location.userDir,
            "GameSettings",
            `${id}.ini`
          );
          const content = await fs.readFile(filePath).catch(() => null);
          return [
            id,
            content ? emulatorPathHash(content.toString("utf8")) : null,
          ];
        })
      )
    : [];
  return location
    ? JSON.stringify([
        "dolphin-v1",
        location.userDir,
        location.configPath,
        (["A", "B"] as const).map((slot) =>
          dolphinSlotEnvironmentSignature(location, slot)
        ),
        location.get("General", "NANDRootPath"),
        gameSettings,
        overrides,
      ])
    : overrides.length
      ? JSON.stringify(["dolphin-save-root-unresolved", overrides])
      : "dolphin-save-root-unresolved";
};

export const getDolphinGameSaveFileFilter =
  (game: Game) => async (filePath: string) => {
    const ids = gameIds(game);
    const name = path.basename(filePath);
    if (/\.gci$/i.test(name))
      return ids.includes((await readGci(filePath).catch(() => null)) ?? "");
    if (
      ids.some((id) =>
        new RegExp(`^${id}\\.s\\d{2}(?:\\.dtm)?$`, "i").test(name)
      )
    ) {
      const primaryPath = name.endsWith(".dtm")
        ? filePath.slice(0, -4)
        : filePath;
      const state = await readDolphinStateIdentity(primaryPath).catch(
        () => null
      );
      return !!state && ids.includes(state.gameId);
    }
    if (isWii(game)) {
      const normalized = filePath.split(path.sep).join("/").toLowerCase();
      for (const id of ids) {
        const marker = `/title/00010000/${titleIdForWiiGame(id).slice(8)}/data/`;
        const index = normalized.indexOf(marker);
        if (index < 0) continue;
        const titleRoot = filePath.slice(
          0,
          index + marker.length - "/data/".length
        );
        if ((await readWiiTitleGameId(titleRoot, titleIdForWiiGame(id))) === id)
          return true;
      }
    }
    return false;
  };

export const resolveDolphinRawCardTarget = async (
  game: Game,
  file: RestoreManifestFile
): Promise<string | null> => {
  const parsed = parseDolphinRawCardPath(file.rawPath);
  if (!parsed || !gameIds(game).includes(parsed.gameId)) return null;
  const { getEmulatorCardPathOverrides } = await import(
    "./emulator-card-path-store.js"
  );
  const manual = (
    await getEmulatorCardPathOverrides(game, "dolphin").catch(() => [])
  ).find((item) => item.slot === parsed.slot);
  if (manual) return manual.path;
  const location = await resolveDolphinSaveLocation().catch(() => null);
  if (!location) return null;
  const gameLocation = await withGameSettings(location, parsed.gameId).catch(
    () => location
  );
  if (slotMode(gameLocation, parsed.slot) !== "raw") return null;
  const region = regionForGame(parsed.gameId);
  if (!region) return null;
  const paths = await rawCardCandidates(gameLocation, parsed.slot, region);
  const existing: string[] = [];
  for (const candidate of paths) {
    if (await lstatIfExists(candidate).catch(() => null))
      existing.push(candidate);
  }
  return existing.length === 1 ? existing[0] : null;
};

export const resolveDolphinRestoreRules = async (
  game: Game,
  files: RestoreManifestFile[],
  location: DolphinLocation | null,
  manualCards: { path: string; slot: string }[] = []
): Promise<Map<string, CloudSaveRule>> => {
  const result = new Map<string, CloudSaveRule>();
  const ids = gameIds(game);
  if (!location) {
    for (const file of files) {
      const raw = parseDolphinRawCardPath(file.rawPath);
      if (
        !raw ||
        !ids.includes(raw.gameId) ||
        !/^[a-f0-9]{24}\.gci$/.test(file.relativePath) ||
        !manualCards.some((item) => item.slot === raw.slot)
      ) {
        continue;
      }
      const target = manualCards.find((item) => item.slot === raw.slot)!.path;
      const root = path.join(
        os.tmpdir(),
        "hydra-dolphin-card-v2-restore",
        emulatorPathHash(target),
        raw.slot,
        raw.gameId
      );
      if (await safeRestorePath(root, [file.relativePath])) {
        result.set(
          emulatorSaveFileKey(file),
          emulatorRestoreRule(file.rawPath, root, "dir")
        );
      }
    }
    return result;
  }
  const stateNames = new Set(
    files
      .filter((file) => STATE_PATH.test(file.rawPath))
      .map((file) => file.relativePath)
  );
  for (const file of files) {
    const segments = safeRelativeSegments(file.relativePath);
    if (!segments) continue;
    const gci = GCI_PATH.exec(file.rawPath);
    const state = STATE_PATH.exec(file.rawPath);
    const wii = WII_PATH.exec(file.rawPath);
    const raw = parseDolphinRawCardPath(file.rawPath);
    const fileId =
      gci?.[2] ??
      state?.[1] ??
      raw?.gameId ??
      ids.find((id) => wii?.[1] === titleIdForWiiGame(id));
    const gameLocation = fileId
      ? await withGameSettings(location, fileId).catch(() => location)
      : location;
    if (
      gci &&
      ids.includes(gci[2]) &&
      !isWii(game) &&
      segments.length === 1 &&
      /\.gci$/i.test(segments[0]) &&
      slotMode(gameLocation, gci[1] as "A" | "B") === "gci"
    ) {
      const region = regionForGame(gci[2]);
      if (!region) continue;
      const slot = gci[1] as "A" | "B";
      const customRoot = configuredGciRoot(gameLocation, slot);
      if (customRoot) {
        const stat = await lstatIfExists(customRoot).catch(() => null);
        if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
      }
      const root = gciRoot(gameLocation, slot, region);
      if (!(await safeRestorePath(root, segments))) continue;
      const existing = await lstatIfExists(path.join(root, segments[0])).catch(
        () => undefined
      );
      if (
        existing &&
        (!existing.isFile() ||
          (await readGci(path.join(root, segments[0]))) !== gci[2])
      )
        continue;
      result.set(
        emulatorSaveFileKey(file),
        emulatorRestoreRule(file.rawPath, root, "dir")
      );
    } else if (
      state &&
      ids.includes(state[1]) &&
      segments.length === 1 &&
      new RegExp(`^${state[1]}\\.s\\d{2}(?:\\.dtm)?$`, "i").test(segments[0]) &&
      (!segments[0].endsWith(".dtm") ||
        stateNames.has(segments[0].slice(0, -4)))
    ) {
      const root = path.join(location.userDir, "StateSaves");
      if (await safeRestorePath(root, segments)) {
        result.set(
          emulatorSaveFileKey(file),
          emulatorRestoreRule(file.rawPath, root, "dir")
        );
      }
    } else if (
      wii &&
      isWii(game) &&
      ids.some((id) => titleIdForWiiGame(id) === wii[1])
    ) {
      const nand = gameLocation.get("General", "NANDRootPath");
      const wiiRoot = nand
        ? configuredPath(gameLocation.userDir, nand)
        : path.join(location.userDir, "Wii");
      if (nand) {
        const nandStat = await lstatIfExists(wiiRoot).catch(() => null);
        if (!nandStat?.isDirectory() || nandStat.isSymbolicLink()) continue;
      }
      const titleRoot = path.join(
        wiiRoot,
        "title",
        "00010000",
        wii[1].slice(8)
      );
      const gameId = ids.find((id) => titleIdForWiiGame(id) === wii[1]);
      if (
        !gameId ||
        !(await wiiTitleCanReceiveRestore(titleRoot, wii[1], gameId))
      )
        continue;
      const root = path.join(titleRoot, "data");
      if (
        await safeRestorePath(wiiRoot, [
          "title",
          "00010000",
          wii[1].slice(8),
          "data",
          ...segments,
        ])
      ) {
        result.set(
          emulatorSaveFileKey(file),
          emulatorRestoreRule(file.rawPath, root, "dir")
        );
      }
    } else if (
      raw &&
      ids.includes(raw.gameId) &&
      /^[a-f0-9]{24}\.gci$/.test(file.relativePath) &&
      segments.length === 1
    ) {
      const target =
        manualCards.find((item) => item.slot === raw.slot)?.path ??
        (await resolveDolphinRawCardTarget(game, file));
      if (!target) continue;
      const root = path.join(
        os.tmpdir(),
        "hydra-dolphin-card-v2-restore",
        emulatorPathHash(target),
        raw.slot,
        raw.gameId
      );
      if (await safeRestorePath(root, segments)) {
        result.set(
          emulatorSaveFileKey(file),
          emulatorRestoreRule(file.rawPath, root, "dir")
        );
      }
    }
  }
  return result;
};

export const dolphinSaveProvider: EmulatorProvider = {
  async discover(context) {
    const location = await resolveDolphinSaveLocation().catch(() => null);
    const { getEmulatorCardPathOverrides } = await import(
      "./emulator-card-path-store.js"
    );
    const manualCards = await getEmulatorCardPathOverrides(
      context.game,
      "dolphin"
    ).catch(() => []);
    return scanDolphinSaveRoot(context, location, manualCards);
  },
  async restoreRules(game, files) {
    const location = await resolveDolphinSaveLocation().catch(() => null);
    const { getEmulatorCardPathOverrides } = await import(
      "./emulator-card-path-store.js"
    );
    const manualCards = await getEmulatorCardPathOverrides(
      game,
      "dolphin"
    ).catch(() => []);
    return resolveDolphinRestoreRules(game, files, location, manualCards);
  },
};
