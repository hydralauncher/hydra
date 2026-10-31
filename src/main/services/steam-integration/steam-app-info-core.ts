import fs from "node:fs";
import path from "node:path";

export const STEAM_APP_INFO_MAGIC_V39 = 0x07564427;
export const STEAM_APP_INFO_MAGIC_V40 = 0x07564428;
export const STEAM_APP_INFO_MAGIC_V41 = 0x07564429;

const READ_CHUNK_SIZE = 4 * 1024 * 1024;

const KEY_VALUES_TYPE = {
  map: 0x00,
  string: 0x01,
  int32: 0x02,
  float32: 0x03,
  pointer: 0x04,
  wideString: 0x05,
  color: 0x06,
  uint64: 0x07,
  end: 0x08,
  int64: 0x0a,
  alternateEnd: 0x0b,
} as const;

const SKIPPED_LAUNCH_TYPES = new Set(["server", "editor", "config", "manual"]);

export type SteamKeyValue = string | number | bigint | SteamKeyValues;

export interface SteamKeyValues {
  [key: string]: SteamKeyValue;
}

export interface SteamLaunchEntry {
  executable: string;
  arguments: string | null;
  type: string | null;
  oslist: string[];
  osarch: string | null;
  betakey: string | null;
}

export interface SteamAppInfo {
  appId: string;
  type: string | null;
  name: string | null;
  launch: SteamLaunchEntry[];
}

interface AppInfoLayout {
  entriesOffset: number;
  fixedFieldsSize: number;
  stringTableOffset: number | null;
}

const getLayout = (header: Buffer): AppInfoLayout => {
  const magic = header.readUInt32LE(0);

  if (magic === STEAM_APP_INFO_MAGIC_V39) {
    return { entriesOffset: 8, fixedFieldsSize: 40, stringTableOffset: null };
  }

  if (magic === STEAM_APP_INFO_MAGIC_V40) {
    return { entriesOffset: 8, fixedFieldsSize: 60, stringTableOffset: null };
  }

  if (magic === STEAM_APP_INFO_MAGIC_V41) {
    return {
      entriesOffset: 16,
      fixedFieldsSize: 60,
      stringTableOffset: Number(header.readBigInt64LE(8)),
    };
  }

  throw new Error(`unsupported-steam-appinfo-version:${magic.toString(16)}`);
};

const readCString = (buffer: Buffer, offset: number) => {
  const end = buffer.indexOf(0, offset);
  if (end === -1) throw new RangeError("unterminated-string");

  return { value: buffer.toString("utf8", offset, end), next: end + 1 };
};

const readWideString = (buffer: Buffer, offset: number) => {
  let end = offset;

  while (end + 1 < buffer.length && buffer.readUInt16LE(end) !== 0) {
    end += 2;
  }

  if (end + 1 >= buffer.length) throw new RangeError("unterminated-string");

  return { value: buffer.toString("utf16le", offset, end), next: end + 2 };
};

export const parseSteamStringTable = (buffer: Buffer): string[] => {
  const count = buffer.readUInt32LE(0);
  const strings: string[] = [];
  let offset = 4;

  for (let index = 0; index < count; index += 1) {
    const { value, next } = readCString(buffer, offset);
    strings.push(value);
    offset = next;
  }

  return strings;
};

export const parseBinaryKeyValues = (
  buffer: Buffer,
  offset = 0,
  stringTable: string[] | null = null
): SteamKeyValues => {
  let position = offset;

  const readKey = () => {
    if (stringTable) {
      const index = buffer.readUInt32LE(position);
      position += 4;

      const key = stringTable[index];
      if (key === undefined) throw new RangeError("unknown-string-index");
      return key;
    }

    const { value, next } = readCString(buffer, position);
    position = next;
    return value;
  };

  const readMap = (): SteamKeyValues => {
    const result: SteamKeyValues = {};

    for (;;) {
      const type = buffer.readUInt8(position);
      position += 1;

      if (
        type === KEY_VALUES_TYPE.end ||
        type === KEY_VALUES_TYPE.alternateEnd
      ) {
        return result;
      }

      const key = readKey();

      switch (type) {
        case KEY_VALUES_TYPE.map:
          result[key] = readMap();
          break;
        case KEY_VALUES_TYPE.string: {
          const { value, next } = readCString(buffer, position);
          result[key] = value;
          position = next;
          break;
        }
        case KEY_VALUES_TYPE.wideString: {
          const { value, next } = readWideString(buffer, position);
          result[key] = value;
          position = next;
          break;
        }
        case KEY_VALUES_TYPE.int32:
        case KEY_VALUES_TYPE.pointer:
        case KEY_VALUES_TYPE.color:
          result[key] = buffer.readInt32LE(position);
          position += 4;
          break;
        case KEY_VALUES_TYPE.float32:
          result[key] = buffer.readFloatLE(position);
          position += 4;
          break;
        case KEY_VALUES_TYPE.uint64:
          result[key] = buffer.readBigUInt64LE(position);
          position += 8;
          break;
        case KEY_VALUES_TYPE.int64:
          result[key] = buffer.readBigInt64LE(position);
          position += 8;
          break;
        default:
          throw new RangeError(`unsupported-key-values-type:${type}`);
      }
    }
  };

  return readMap();
};

const getChild = (
  value: SteamKeyValue | undefined,
  key: string
): SteamKeyValue | undefined => {
  if (!value || typeof value !== "object") return undefined;

  const lowerKey = key.toLowerCase();
  const match = Object.keys(value).find(
    (candidate) => candidate.toLowerCase() === lowerKey
  );

  return match === undefined ? undefined : value[match];
};

const getString = (value: SteamKeyValue | undefined, key: string) => {
  const child = getChild(value, key);
  if (child === undefined || typeof child === "object") return null;

  const text = String(child).trim();
  return text || null;
};

const toLaunchEntry = (value: SteamKeyValue): SteamLaunchEntry | null => {
  const executable = getString(value, "executable");
  if (!executable) return null;

  const config = getChild(value, "config");
  const oslist = getString(config, "oslist");

  return {
    executable,
    arguments: getString(value, "arguments"),
    type: getString(value, "type")?.toLowerCase() ?? null,
    oslist: oslist
      ? oslist
          .split(",")
          .map((os) => os.trim().toLowerCase())
          .filter(Boolean)
      : [],
    osarch: getString(config, "osarch"),
    betakey: getString(config, "betakey"),
  };
};

export const toSteamAppInfo = (
  appId: string,
  keyValues: SteamKeyValues
): SteamAppInfo => {
  const root = getChild(keyValues, "appinfo") ?? keyValues;
  const common = getChild(root, "common");
  const launch = getChild(getChild(root, "config"), "launch");

  const launchEntries =
    launch && typeof launch === "object"
      ? Object.keys(launch)
          .sort((a, b) => Number(a) - Number(b))
          .map((key) => toLaunchEntry(launch[key]))
          .filter((entry): entry is SteamLaunchEntry => entry !== null)
      : [];

  return {
    appId,
    type: getString(common, "type")?.toLowerCase() ?? null,
    name: getString(common, "name"),
    launch: launchEntries,
  };
};

class SequentialFileReader {
  private window = Buffer.alloc(0);
  private windowStart = 0;

  constructor(
    private readonly handle: fs.promises.FileHandle,
    private readonly fileSize: number
  ) {}

  async read(position: number, length: number): Promise<Buffer> {
    const windowOffset = position - this.windowStart;

    if (windowOffset >= 0 && windowOffset + length <= this.window.length) {
      return this.window.subarray(windowOffset, windowOffset + length);
    }

    if (position + length > this.fileSize) {
      throw new RangeError("steam-appinfo-truncated");
    }

    const size = Math.min(
      Math.max(length, READ_CHUNK_SIZE),
      this.fileSize - position
    );
    const chunk = Buffer.alloc(size);
    const { bytesRead } = await this.handle.read(chunk, 0, size, position);

    if (bytesRead < length) throw new RangeError("steam-appinfo-truncated");

    this.window = chunk.subarray(0, bytesRead);
    this.windowStart = position;

    return this.window.subarray(0, length);
  }
}

const readStringTable = async (
  handle: fs.promises.FileHandle,
  offset: number,
  fileSize: number
) => {
  if (offset <= 0 || offset >= fileSize) {
    throw new RangeError("steam-appinfo-invalid-string-table");
  }

  const buffer = Buffer.alloc(fileSize - offset);
  await handle.read(buffer, 0, buffer.length, offset);

  return parseSteamStringTable(buffer);
};

export const readSteamAppInfo = async (
  filePath: string,
  appIds: Iterable<string>
): Promise<Map<string, SteamAppInfo>> => {
  const wantedAppIds = new Set(
    [...appIds].filter((appId) => /^\d+$/.test(appId))
  );
  const appInfos = new Map<string, SteamAppInfo>();

  if (wantedAppIds.size === 0) return appInfos;

  const handle = await fs.promises.open(filePath, "r");

  try {
    const { size: fileSize } = await handle.stat();
    const reader = new SequentialFileReader(handle, fileSize);
    const layout = getLayout(await reader.read(0, Math.min(16, fileSize)));
    const stringTable =
      layout.stringTableOffset === null
        ? null
        : await readStringTable(handle, layout.stringTableOffset, fileSize);
    const entriesEnd = layout.stringTableOffset ?? fileSize;

    let position = layout.entriesOffset;

    while (position + 8 <= entriesEnd && appInfos.size < wantedAppIds.size) {
      const entryHeader = await reader.read(position, 8);
      const appId = entryHeader.readUInt32LE(0);
      const size = entryHeader.readUInt32LE(4);

      if (appId === 0) break;

      const entryStart = position + 8;
      const appIdText = String(appId);

      if (wantedAppIds.has(appIdText) && size > layout.fixedFieldsSize) {
        const entry = await reader.read(entryStart, size);

        try {
          appInfos.set(
            appIdText,
            toSteamAppInfo(
              appIdText,
              parseBinaryKeyValues(entry, layout.fixedFieldsSize, stringTable)
            )
          );
        } catch {
          appInfos.delete(appIdText);
        }
      }

      position = entryStart + size;
    }
  } finally {
    await handle.close();
  }

  return appInfos;
};

const FALLBACK_LAUNCH_TYPE_PRIORITY = 10;

const getLaunchTypePriority = (type: string | null) => {
  if (!type || type === "default") return 0;
  if (type === "none") return 1;

  const option = /^option(\d+)$/.exec(type);
  if (option) return 1 + Number(option[1]);

  return FALLBACK_LAUNCH_TYPE_PRIORITY;
};

const NATIVE_STEAM_OPERATING_SYSTEMS: Partial<Record<NodeJS.Platform, string>> =
  {
    win32: "windows",
    darwin: "macos",
  };

const getOperatingSystemTier = (
  oslist: string[],
  platform: NodeJS.Platform
): number | null => {
  const nativeOperatingSystem =
    NATIVE_STEAM_OPERATING_SYSTEMS[platform] ?? "linux";

  if (oslist.includes(nativeOperatingSystem)) return 0;
  if (oslist.length === 0) return 1;
  if (platform === "linux" && oslist.includes("windows")) return 1;

  return null;
};

export const selectSteamLaunchCandidates = (
  appInfo: SteamAppInfo,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): SteamLaunchEntry[] => {
  const is64Bit = arch === "x64" || arch === "arm64";

  return appInfo.launch
    .map((entry, index) => ({
      entry,
      index,
      tier: getOperatingSystemTier(entry.oslist, platform),
    }))
    .filter(
      (
        candidate
      ): candidate is {
        entry: SteamLaunchEntry;
        index: number;
        tier: number;
      } =>
        candidate.tier !== null &&
        !SKIPPED_LAUNCH_TYPES.has(candidate.entry.type ?? "") &&
        !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate.entry.executable) &&
        !(candidate.entry.osarch === "64" && !is64Bit)
    )
    .sort(
      (a, b) =>
        Number(a.entry.betakey !== null) - Number(b.entry.betakey !== null) ||
        a.tier - b.tier ||
        getLaunchTypePriority(a.entry.type) -
          getLaunchTypePriority(b.entry.type) ||
        Number(is64Bit && a.entry.osarch === "32") -
          Number(is64Bit && b.entry.osarch === "32") ||
        a.index - b.index
    )
    .map(({ entry }) => entry);
};

export const toSteamExecutableSegments = (executable: string): string[] =>
  executable
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .split(/[\\/]+/)
    .filter((segment) => segment !== "" && segment !== ".");

export interface SteamLaunchExecutable {
  appId: string;
  executablePath: string;
  appType: string | null;
}

const isFile = (filePath: string) =>
  fs.promises
    .stat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false);

const findEntryIgnoringCase = async (directory: string, name: string) => {
  const entries = await fs.promises.readdir(directory).catch(() => []);
  const lowerName = name.toLowerCase();

  return entries.find((entry) => entry.toLowerCase() === lowerName) ?? null;
};

export const resolvePathIgnoringCase = async (
  root: string,
  segments: string[],
  platform: NodeJS.Platform = process.platform
): Promise<string | null> => {
  const exactPath = path.join(root, ...segments);

  if (await isFile(exactPath)) return exactPath;
  if (platform === "win32") return null;

  let current = root;

  for (const segment of segments) {
    if (segment === "..") return null;

    const match = await findEntryIgnoringCase(current, segment);
    if (!match) return null;

    current = path.join(current, match);
  }

  return (await isFile(current)) ? current : null;
};

export const resolveSteamAppExecutable = async (
  appInfo: SteamAppInfo,
  installDirectory: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Promise<string | null> => {
  for (const candidate of selectSteamLaunchCandidates(
    appInfo,
    platform,
    arch
  )) {
    const segments = toSteamExecutableSegments(candidate.executable);
    if (segments.length === 0 || segments.includes("..")) continue;

    const executablePath = await resolvePathIgnoringCase(
      installDirectory,
      segments,
      platform
    );

    if (executablePath) return executablePath;
  }

  return null;
};

export const resolveSteamLaunchExecutables = async (
  appInfos: Map<string, SteamAppInfo>,
  installDirectories: Map<string, string>,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Promise<Map<string, SteamLaunchExecutable>> => {
  const executables = new Map<string, SteamLaunchExecutable>();

  for (const [appId, installDirectory] of installDirectories) {
    const appInfo = appInfos.get(appId);
    if (!appInfo) continue;

    const executablePath = await resolveSteamAppExecutable(
      appInfo,
      installDirectory,
      platform,
      arch
    );

    if (executablePath) {
      executables.set(appId, {
        appId,
        executablePath,
        appType: appInfo.type,
      });
    }
  }

  return executables;
};
