import { promises as fs } from "node:fs";
import { createCipheriv, createHash } from "node:crypto";
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
const DOLPHIN_WII_GAME_CODE_RE = /^[A-Z0-9]{4}$/;
const WII_TMD_TITLE_ID_OFFSET = 0x18c;
const WII_TMD_GROUP_ID_OFFSET = 0x198;

const WII_SAVE_BLOCK_SIZE = 0x40;
const WII_SAVE_BANNER_SIZE = 0x60a0;
const WII_SAVE_ICON_SIZE = 0x1200;
const WII_SAVE_MIN_BANNER_SIZE = 0x72a0;
const WII_SAVE_MAX_BANNER_SIZE = 0xf0a0;
const WII_SAVE_HEADER_SIZE = 0xf0c0;
const WII_SAVE_BACKUP_HEADER_SIZE = 0x80;
const WII_SAVE_FILE_HEADER_SIZE = 0x80;
const WII_SAVE_CERTIFICATE_FOOTER_SIZE = 0x3c0;
const WII_SAVE_DEFAULT_DEVICE_ID = 0x0403ac68;
const WII_SAVE_HEADER_MAGIC = 0x426b0001;
const WII_SAVE_FILE_MAGIC = 0x03adf17e;
const WII_SAVE_MODE_READ_WRITE = 0x3f;
const WII_SAVE_SD_KEY = Buffer.from("ab01b9d8e1622b08afbad84dbfc2a55d", "hex");
const WII_SAVE_INITIAL_IV = Buffer.from(
  "216712e6aa1f689f95c5a22324dc6a98",
  "hex"
);
const WII_SAVE_MD5_BLANKER = Buffer.from(
  "0e65378199be4517ab06ec22451a5793",
  "hex"
);

export const emulationSavePlatformToSystem = (
  platform: EmulationSavePlatform
): EmulatorSystem => {
  if (platform === "gamecube" || platform === "wii") return "dolphin";
  return platform;
};

export interface DiscoveredEmulationFileSave {
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube" | "wii">;
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

const resolveDolphinNandRoot = (
  userDirectory: string,
  configuredPath: string
): string => {
  let expanded = configuredPath;
  if (configuredPath.startsWith("~/")) {
    expanded = path.join(os.homedir(), configuredPath.slice(2));
  } else if (configuredPath === "~") {
    expanded = os.homedir();
  }
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(userDirectory, expanded);
};

const dolphinWiiRootCandidates = async (
  userDirectory: string
): Promise<string[]> => {
  const roots = [path.join(userDirectory, "Wii")];
  try {
    const config = await fs.readFile(
      path.join(userDirectory, "Config", "Dolphin.ini"),
      "utf8"
    );
    const configured = parseIniValue(config, "NANDRootPath");
    if (configured) {
      roots.unshift(resolveDolphinNandRoot(userDirectory, configured));
    }
  } catch {
    // Dolphin.ini is optional; the default NAND remains a valid candidate.
  }
  return Array.from(new Set(roots));
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
    const candidates = [
      parseParamSfoValue(sfo, "DISC_ID"),
      parseParamSfoValue(sfo, "SAVEDATA_DIRECTORY"),
      path.basename(savedataDirectory),
    ];

    for (const candidate of candidates) {
      const normalized = candidate?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const discId = normalized?.slice(0, 9);
      if (discId && PSP_DISC_ID_RE.test(discId)) return discId;
    }

    return null;
  } catch {
    return null;
  }
};

const discoverPpssppSaves = async (
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

const discoverDolphinGamecubeSaves = async (
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

const parseWiiTitleDirectory = (
  titleDirectory: string
): { titleId: string; gameCode: string } | null => {
  if (!/^[a-f\d]{8}$/i.test(titleDirectory)) return null;
  const gameCode = Buffer.from(titleDirectory, "hex")
    .toString("ascii")
    .toUpperCase();
  if (!DOLPHIN_WII_GAME_CODE_RE.test(gameCode)) return null;
  return {
    gameCode,
    titleId: `00010000${titleDirectory.toLowerCase()}`,
  };
};

const readDolphinWiiGameId = async (
  titlePath: string,
  identity: { titleId: string; gameCode: string }
): Promise<string> => {
  const tmd = await fs
    .readFile(path.join(titlePath, "content", "title.tmd"))
    .catch(() => null);
  if (!tmd || tmd.length < WII_TMD_GROUP_ID_OFFSET + 2) {
    return identity.gameCode;
  }

  const titleId = tmd
    .subarray(WII_TMD_TITLE_ID_OFFSET, WII_TMD_TITLE_ID_OFFSET + 8)
    .toString("hex");
  const groupId = tmd
    .subarray(WII_TMD_GROUP_ID_OFFSET, WII_TMD_GROUP_ID_OFFSET + 2)
    .toString("ascii")
    .toUpperCase();
  const gameId = `${identity.gameCode}${groupId}`;
  return titleId === identity.titleId && DOLPHIN_GAME_ID_RE.test(gameId)
    ? gameId
    : identity.gameCode;
};

const discoverDolphinWiiSavesInRoot = async (
  wiiRoot: string
): Promise<DiscoveredEmulationFileSave[]> => {
  const discovered: DiscoveredEmulationFileSave[] = [];
  const titleRoot = path.join(wiiRoot, "title", "00010000");
  const entries = await fs
    .readdir(titleRoot, { withFileTypes: true })
    .catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const identity = parseWiiTitleDirectory(entry.name);
    if (!identity) continue;

    const titlePath = path.join(titleRoot, entry.name);
    const sourcePath = path.join(titlePath, "data");
    const banner = await fs
      .stat(path.join(sourcePath, "banner.bin"))
      .catch(() => null);
    if (!banner?.isFile()) continue;

    const stats = await readDirectoryStats(sourcePath);
    const gameId = await readDolphinWiiGameId(titlePath, identity);
    discovered.push({
      platform: "wii",
      sourcePath,
      sourceLabel: "Wii NAND",
      saveIdentity: identity.titleId,
      sku: gameId,
      ...stats,
      metadata: {
        schemaVersion: 1,
        artifactFormat: "dolphin-wii-data-bin",
        titleId: identity.titleId,
        gameId,
      },
    });
  }

  return discovered;
};

const discoverDolphinWiiSaves = async (
  executablePath: string
): Promise<DiscoveredEmulationFileSave[]> => {
  const discovered: DiscoveredEmulationFileSave[] = [];
  for (const userDirectory of dolphinUserDirectoryCandidates(executablePath)) {
    const wiiRoots = await dolphinWiiRootCandidates(userDirectory);
    for (const wiiRoot of wiiRoots) {
      discovered.push(...(await discoverDolphinWiiSavesInRoot(wiiRoot)));
    }
  }

  return Array.from(
    new Map(discovered.map((save) => [save.sourcePath, save])).values()
  );
};

export const discoverEmulationFileSaves = (
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube" | "wii">,
  executablePath: string
) => {
  if (platform === "psp") return discoverPpssppSaves(executablePath);
  if (platform === "wii") return discoverDolphinWiiSaves(executablePath);
  return discoverDolphinGamecubeSaves(executablePath);
};

interface WiiSaveEntry {
  relativePath: string;
  sourcePath: string;
  type: "file" | "directory";
}

const collectWiiSaveEntries = async (
  dataDirectory: string
): Promise<WiiSaveEntry[]> => {
  const entries: WiiSaveEntry[] = [];
  const pending = [dataDirectory];

  while (pending.length > 0) {
    const directory = pending.pop()!;
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (directory === dataDirectory && child.name === "banner.bin") continue;
      const sourcePath = path.join(directory, child.name);
      const relativePath = path
        .relative(dataDirectory, sourcePath)
        .split(path.sep)
        .join("/");
      if (Buffer.byteLength(relativePath) > 0x40) {
        throw new Error(`Wii save path is too long: ${relativePath}`);
      }
      if (child.isDirectory()) {
        entries.push({ relativePath, sourcePath, type: "directory" });
        pending.push(sourcePath);
      } else if (child.isFile()) {
        entries.push({ relativePath, sourcePath, type: "file" });
      }
    }
  }

  return entries;
};

const alignWiiSaveBlock = (size: number): number =>
  Math.ceil(size / WII_SAVE_BLOCK_SIZE) * WII_SAVE_BLOCK_SIZE;

const encryptWiiSaveData = (data: Buffer, iv: Buffer): Buffer => {
  // The Wii data.bin format mandates AES-128-CBC without padding. This is
  // container compatibility, not encryption used to protect Hydra data.
  const cipher = createCipheriv("aes-128-cbc", WII_SAVE_SD_KEY, iv); // NOSONAR
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
};

/**
 * Creates the data.bin container accepted by Dolphin's Wii save importer.
 * Dolphin does not verify the certificate footer during import, so a correctly
 * sized empty footer keeps this implementation independent from Dolphin's GPL
 * ECC code. The resulting file targets Dolphin, not physical Wii hardware.
 */
export const buildDolphinWiiDataBin = async (
  dataDirectory: string,
  titleId: string
): Promise<Buffer> => {
  if (!/^00010000[a-f\d]{8}$/i.test(titleId)) {
    throw new Error("Invalid Wii disc title ID");
  }

  const banner = await fs.readFile(path.join(dataDirectory, "banner.bin"));
  const bannerHasValidSize =
    banner.length >= WII_SAVE_MIN_BANNER_SIZE &&
    banner.length <= WII_SAVE_MAX_BANNER_SIZE &&
    (banner.length - WII_SAVE_BANNER_SIZE) % WII_SAVE_ICON_SIZE === 0;
  if (!bannerHasValidSize) {
    throw new Error("Wii save banner.bin has an invalid size");
  }

  const titleIdValue = BigInt(`0x${titleId}`);
  const plainHeader = Buffer.alloc(WII_SAVE_HEADER_SIZE);
  plainHeader.writeBigUInt64BE(titleIdValue, 0);
  plainHeader.writeUInt32BE(banner.length, 0x08);
  plainHeader[0x0c] = WII_SAVE_MODE_READ_WRITE;
  WII_SAVE_MD5_BLANKER.copy(plainHeader, 0x0e);
  banner.copy(plainHeader, 0x20);
  plainHeader[0x27] &= ~1;
  // The Wii data.bin header mandates this MD5 integrity field. It is not used
  // for password hashing, signatures, or any security decision.
  createHash("md5") // NOSONAR
    .update(plainHeader)
    .digest()
    .copy(plainHeader, 0x0e);
  const encryptedHeader = encryptWiiSaveData(plainHeader, WII_SAVE_INITIAL_IV);

  const entries = await collectWiiSaveEntries(dataDirectory);
  const serializedEntries: Buffer[] = [];
  let sizeOfFiles = 0;
  for (const entry of entries) {
    const fileHeader = Buffer.alloc(WII_SAVE_FILE_HEADER_SIZE);
    fileHeader.writeUInt32BE(WII_SAVE_FILE_MAGIC, 0);
    fileHeader[0x08] = WII_SAVE_MODE_READ_WRITE;
    fileHeader[0x0a] = entry.type === "file" ? 1 : 2;
    fileHeader.write(entry.relativePath, 0x0b, 0x40, "utf8");
    serializedEntries.push(fileHeader);
    sizeOfFiles += fileHeader.length;

    if (entry.type === "file") {
      const contents = await fs.readFile(entry.sourcePath);
      fileHeader.writeUInt32BE(contents.length, 0x04);
      const padded = Buffer.alloc(alignWiiSaveBlock(contents.length));
      contents.copy(padded);
      const encrypted = encryptWiiSaveData(padded, Buffer.alloc(16));
      serializedEntries.push(encrypted);
      sizeOfFiles += encrypted.length;
    }
  }

  const backupHeader = Buffer.alloc(WII_SAVE_BACKUP_HEADER_SIZE);
  backupHeader.writeUInt32BE(0x70, 0);
  backupHeader.writeUInt32BE(WII_SAVE_HEADER_MAGIC, 0x04);
  backupHeader.writeUInt32BE(WII_SAVE_DEFAULT_DEVICE_ID, 0x08);
  backupHeader.writeUInt32BE(entries.length, 0x0c);
  backupHeader.writeUInt32BE(sizeOfFiles, 0x10);
  backupHeader.writeUInt32BE(
    sizeOfFiles + WII_SAVE_CERTIFICATE_FOOTER_SIZE,
    0x1c
  );
  backupHeader.writeBigUInt64BE(titleIdValue, 0x60);

  return Buffer.concat([
    encryptedHeader,
    backupHeader,
    ...serializedEntries,
    Buffer.alloc(WII_SAVE_CERTIFICATE_FOOTER_SIZE),
  ]);
};

const isSafeEmulationSaveArchiveEntry = (entry: string): boolean => {
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
