import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  EmulationSaveMetadata,
  EmulationSavePlatform,
  EmulatorSystem,
} from "@types";
import { parseParamSfoValue } from "./param-sfo.js";
import { ppssppConfigCandidates } from "./ppsspp-paths.js";
import { dolphinUserDirectoryCandidates } from "./emulator-log-paths.js";

const PSP_DISC_ID_RE = /^[A-Z]{4}\d{5}$/;
const DOLPHIN_GAME_ID_RE = /^[A-Z0-9]{6}$/;

export const emulationSavePlatformToSystem = (
  platform: EmulationSavePlatform
): EmulatorSystem => {
  if (platform === "gamecube" || platform === "wii") return "dolphin";
  return platform;
};

export interface DiscoveredEmulationFileSave {
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube">;
  sourcePath: string;
  sourceLabel: string;
  saveIdentity: string;
  sku: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
  metadata: EmulationSaveMetadata;
}

const readDirectoryStats = async (
  directoryPath: string
): Promise<
  Pick<
    DiscoveredEmulationFileSave,
    "fileCount" | "sizeBytes" | "createdAt" | "modifiedAt"
  >
> => {
  let fileCount = 0;
  let sizeBytes = 0;
  let createdAt = Number.POSITIVE_INFINITY;
  let modifiedAt = 0;
  const pending = [directoryPath];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await fs
      .readdir(current, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(entryPath).catch(() => null);
      if (!stat) continue;
      fileCount += 1;
      sizeBytes += stat.size;
      createdAt = Math.min(createdAt, stat.birthtimeMs || stat.ctimeMs);
      modifiedAt = Math.max(modifiedAt, stat.mtimeMs);
    }
  }

  const fallback = Date.now();
  return {
    fileCount,
    sizeBytes,
    createdAt: Number.isFinite(createdAt) ? createdAt : fallback,
    modifiedAt: modifiedAt || fallback,
  };
};

const parseIniValue = (content: string, key: string): string | null => {
  const normalizedKey = key.toLowerCase();
  for (const line of content.split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;
    if (line.slice(0, separatorIndex).trim().toLowerCase() !== normalizedKey) {
      continue;
    }

    const rawValue = line.slice(separatorIndex + 1).trim();
    const isQuoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    const value = isQuoted ? rawValue.slice(1, -1).trim() : rawValue;
    return value || null;
  }
  return null;
};

const resolveConfiguredMemstick = (
  configPath: string,
  configuredPath: string
): string => {
  const expanded = configuredPath.startsWith("~")
    ? path.join(os.homedir(), configuredPath.slice(1))
    : configuredPath;
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(configPath), expanded);
};

export const ppssppSavedataDirectoryCandidates = async (
  executablePath: string
): Promise<string[]> => {
  const directories: string[] = [];
  const preferredDirectories: string[] = [];
  for (const configPath of ppssppConfigCandidates(executablePath)) {
    const pspDirectory = path.dirname(path.dirname(configPath));
    const conventionalDirectory = path.join(pspDirectory, "SAVEDATA");
    directories.push(conventionalDirectory);

    try {
      const config = await fs.readFile(configPath, "utf8");
      preferredDirectories.push(conventionalDirectory);
      const configured = parseIniValue(config, "MemStickDirectory");
      if (configured) {
        preferredDirectories.unshift(
          path.join(
            resolveConfiguredMemstick(configPath, configured),
            "PSP",
            "SAVEDATA"
          )
        );
      }
    } catch {
      // A non-existing candidate still contributes its conventional save path.
    }
  }
  return Array.from(new Set([...preferredDirectories, ...directories]));
};

export const readPpssppSavedataDiscId = async (
  savedataDirectory: string
): Promise<string | null> => {
  try {
    const sfo = await fs.readFile(path.join(savedataDirectory, "PARAM.SFO"));
    const discId = parseParamSfoValue(sfo, "DISC_ID")
      ?.replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
    return discId && PSP_DISC_ID_RE.test(discId) ? discId : null;
  } catch {
    return null;
  }
};

export const discoverPpssppSaves = async (
  executablePath: string
): Promise<DiscoveredEmulationFileSave[]> => {
  const discovered: DiscoveredEmulationFileSave[] = [];
  for (const root of await ppssppSavedataDirectoryCandidates(executablePath)) {
    const entries = await fs
      .readdir(root, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(root, entry.name);
      const discId = await readPpssppSavedataDiscId(sourcePath);
      if (!discId) continue;
      const stats = await readDirectoryStats(sourcePath);
      discovered.push({
        platform: "psp",
        sourcePath,
        sourceLabel: path.basename(root),
        saveIdentity: entry.name,
        sku: discId,
        ...stats,
        metadata: {
          schemaVersion: 1,
          artifactFormat: "ppsspp-savedata-zip",
          discId,
          savedataDirectory: entry.name,
        },
      });
    }
  }
  return Array.from(
    new Map(discovered.map((save) => [save.sourcePath, save])).values()
  );
};

export const parseGciGameId = (header: Buffer): string | null => {
  if (header.length < 6) return null;
  const gameId = header.subarray(0, 6).toString("ascii").toUpperCase();
  return DOLPHIN_GAME_ID_RE.test(gameId) ? gameId : null;
};

export const parseGciInternalFileName = (header: Buffer): string | null => {
  if (header.length < 0x28) return null;
  const value = header
    .subarray(0x08, 0x28)
    .toString("latin1")
    .split("\0", 1)[0]
    .trim();
  if (!value) return null;
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized +=
      codePoint < 0x20 || character === "/" || character === "\\"
        ? "_"
        : character;
  }
  return sanitized.slice(0, 32);
};

const regionFromPath = (
  parts: string[]
): Extract<
  EmulationSaveMetadata,
  { artifactFormat: "dolphin-gci" }
>["region"] => {
  const normalized = new Set(parts.map((part) => part.toUpperCase()));
  if (normalized.has("USA")) return "USA";
  if (normalized.has("JAP") || normalized.has("JPN")) return "JPN";
  if (normalized.has("EUR")) return "EUR";
  if (normalized.has("KOR")) return "KOR";
  if (normalized.has("DEV")) return "DEV";
  return "unknown";
};

const slotFromPath = (parts: string[]): "A" | "B" =>
  parts.some((part) => /(?:card|slot)[ _-]*b/i.test(part)) ? "B" : "A";

const walkGciFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await fs
      .readdir(current, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === ".gci"
      ) {
        files.push(entryPath);
      }
    }
  }
  return files;
};

const inspectGciSave = async (
  sourcePath: string,
  gcRoot: string
): Promise<DiscoveredEmulationFileSave | null> => {
  const file = await fs.open(sourcePath, "r").catch(() => null);
  if (!file) return null;

  let header: Buffer;
  try {
    header = Buffer.alloc(0x40);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) return null;
  } finally {
    await file.close();
  }

  const gameId = parseGciGameId(header);
  const internalFileName = parseGciInternalFileName(header);
  if (!gameId || !internalFileName) return null;

  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat) return null;

  const relativeParts = path.relative(gcRoot, sourcePath).split(path.sep);
  const slot = slotFromPath(relativeParts);
  const region = regionFromPath(relativeParts);
  return {
    platform: "gamecube",
    sourcePath,
    sourceLabel: `${region} · Card ${slot}`,
    saveIdentity: `${slot}:${region}:${gameId}:${internalFileName}`,
    sku: gameId,
    fileCount: 1,
    sizeBytes: stat.size,
    createdAt: stat.birthtimeMs || stat.ctimeMs,
    modifiedAt: stat.mtimeMs,
    metadata: {
      schemaVersion: 1,
      artifactFormat: "dolphin-gci",
      gameId,
      slot,
      region,
      internalFileName,
    },
  };
};

export const discoverDolphinGamecubeSaves = async (
  executablePath: string
): Promise<DiscoveredEmulationFileSave[]> => {
  const discovered: DiscoveredEmulationFileSave[] = [];
  for (const userDirectory of dolphinUserDirectoryCandidates(executablePath)) {
    const gcRoot = path.join(userDirectory, "GC");
    for (const sourcePath of await walkGciFiles(gcRoot)) {
      const save = await inspectGciSave(sourcePath, gcRoot);
      if (save) discovered.push(save);
    }
  }
  return Array.from(
    new Map(discovered.map((save) => [save.sourcePath, save])).values()
  );
};

export const discoverEmulationFileSaves = (
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube">,
  executablePath: string
) =>
  platform === "psp"
    ? discoverPpssppSaves(executablePath)
    : discoverDolphinGamecubeSaves(executablePath);

export const isSafeEmulationSaveArchiveEntry = (entry: string): boolean => {
  const normalized = entry.replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split("/").includes("..")
  );
};

export const archiveEntriesBelongToDirectory = (
  entries: string[],
  directoryName: string
): boolean =>
  entries.length > 0 &&
  entries.every((entry) => {
    const normalizedEntry = entry.replaceAll("\\", "/");
    const normalized = normalizedEntry.endsWith("/")
      ? normalizedEntry.slice(0, -1)
      : normalizedEntry;
    return (
      isSafeEmulationSaveArchiveEntry(normalized) &&
      (normalized === directoryName ||
        normalized.startsWith(`${directoryName}/`))
    );
  });

export const parseDolphinWiiExportPath = (
  filePath: string
): { titleId: string; gameCode: string } | null => {
  const normalized = filePath.replaceAll("\\", "/");
  const match = /\/private\/wii\/title\/([a-z\d]{4})\/data\.bin$/i.exec(
    normalized
  );
  if (!match) return null;
  const gameCode = match[1].toUpperCase();
  return {
    gameCode,
    titleId: `00010000${Buffer.from(gameCode, "ascii").toString("hex")}`,
  };
};
