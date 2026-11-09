import {
  closeSync,
  existsSync,
  openSync,
  promises as fs,
  readSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  findManagedEmulatorExecutable,
  type ManagedExecutableBinary,
} from "./find-managed-emulator-executable";

export const SHADPS4_CORE_DIRECTORY = "core";

export const SHADPS4_CORE_BINARY: ManagedExecutableBinary = {
  displayName: "shadPS4 core",
  windowsNames: ["shadPS4.exe"],
  linuxNames: ["Shadps4-sdl.AppImage", "shadps4"],
  macosBundleNames: [],
};

const PORTABLE_USER_DIR = "user";
const LOG_DIR = "log";
const LOG_READ_LIMIT_BYTES = 64 * 1024;
const LOG_EXTENSIONS = new Set([".log", ".txt"]);
const LOG_VERSION_RE = /Starting shadps4 emulator v(\S+)/;
const RELEASE_VERSION_RE = /\d{1,9}\.\d{1,9}(?:\.\d{1,9})?/;
const VERSION_RECORD_FILE = "shadps4-version.json";

interface Shadps4VersionRecord {
  version: string;
  executableSize: number;
}

const defaultUserDir = (): string => {
  if (process.platform === "win32") {
    const appData =
      process.env["APPDATA"] || path.join(homedir(), "AppData", "Roaming");
    return path.join(appData, "shadPS4");
  }

  const dataHome =
    process.env["XDG_DATA_HOME"] || path.join(homedir(), ".local", "share");
  return path.join(dataHome, "shadPS4");
};

export const resolveShadps4UserDir = (
  executablePath: string | null
): string => {
  if (executablePath) {
    const portableDir = path.join(
      path.dirname(executablePath),
      PORTABLE_USER_DIR
    );
    if (existsSync(portableDir)) return portableDir;
  }
  return defaultUserDir();
};

export const readShadps4ConfiguredDirectory = async (
  executablePath: string | null,
  key: "sys_modules_dir" | "home_dir"
): Promise<string | null> => {
  try {
    const config = JSON.parse(
      await fs.readFile(
        path.join(resolveShadps4UserDir(executablePath), "config.json"),
        "utf8"
      )
    ) as { General?: Record<string, unknown> };
    const configured = config.General?.[key];
    if (typeof configured !== "string" || !configured.trim()) return null;

    return executablePath
      ? path.resolve(path.dirname(executablePath), configured)
      : configured;
  } catch {
    return null;
  }
};

const TROPHY_KEY_RE = /^[0-9a-f]{32}$/i;

export const getShadps4TrophyKeyStatus = async (
  executablePath: string | null
): Promise<{ installed: boolean; path: string }> => {
  const userDir = resolveShadps4UserDir(executablePath);
  try {
    const keys = JSON.parse(
      await fs.readFile(path.join(userDir, "keys.json"), "utf8")
    ) as { TrophyKeySet?: { ReleaseTrophyKey?: unknown } };
    const trophyKey = keys.TrophyKeySet?.ReleaseTrophyKey;
    return {
      installed: typeof trophyKey === "string" && TROPHY_KEY_RE.test(trophyKey),
      path: userDir,
    };
  } catch {
    return { installed: false, path: userDir };
  }
};

const versionRecordPath = (executablePath: string): string =>
  path.join(path.dirname(executablePath), VERSION_RECORD_FILE);

export const writeShadps4VersionRecord = async (
  executablePath: string,
  releaseTag: string | null
): Promise<void> => {
  const version = releaseTag ? RELEASE_VERSION_RE.exec(releaseTag)?.[0] : null;
  if (!version) return;

  const { size } = await fs.stat(executablePath);
  const record: Shadps4VersionRecord = { version, executableSize: size };
  await fs.writeFile(versionRecordPath(executablePath), JSON.stringify(record));
};

const readVersionRecord = (executablePath: string): string | null => {
  try {
    const record = JSON.parse(
      readFileSync(versionRecordPath(executablePath), "utf8")
    ) as Partial<Shadps4VersionRecord>;
    if (
      typeof record.version === "string" &&
      record.executableSize === statSync(executablePath).size
    ) {
      return record.version;
    }
    return null;
  } catch {
    return null;
  }
};

const listLogFilesNewestFirst = (logDir: string): string[] =>
  readdirSync(logDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        LOG_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    )
    .map((entry) => {
      const filePath = path.join(logDir, entry.name);
      return { filePath, modifiedAt: statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .map(({ filePath }) => filePath);

const readFileHead = (filePath: string): string => {
  const fileDescriptor = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(LOG_READ_LIMIT_BYTES);
    const bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fileDescriptor);
  }
};

const readVersionFromLog = (executablePath: string): string | null => {
  try {
    const logFiles = listLogFilesNewestFirst(
      path.join(resolveShadps4UserDir(executablePath), LOG_DIR)
    );
    for (const logFile of logFiles) {
      const version = LOG_VERSION_RE.exec(readFileHead(logFile))?.[1];
      if (version) return version;
    }
    return null;
  } catch {
    return null;
  }
};

export const readShadps4InstalledVersion = readVersionRecord;

export const readShadps4VersionAfterSession = (
  executablePath: string
): string | null =>
  readVersionRecord(executablePath) ?? readVersionFromLog(executablePath);

export const findShadps4CorePath = (launcherPath: string): string | null =>
  findManagedEmulatorExecutable(
    path.join(path.dirname(launcherPath), SHADPS4_CORE_DIRECTORY),
    SHADPS4_CORE_BINARY
  );

export const buildShadps4LaunchArguments = (
  launcherPath: string,
  discPath: string
): string[] => {
  const corePath = findShadps4CorePath(launcherPath);

  return [
    ...(corePath ? ["-e", corePath] : ["-d"]),
    "-i",
    "-g",
    discPath,
    "--",
    "--fullscreen",
    "true",
  ];
};

interface Shadps4ProcessIdentity {
  pid: number;
  name: string;
  parentPid?: number | null;
  exe?: string | null;
  environ?: Record<string, string> | null;
}

const resolveExecutableIdentity = (executablePath: string): string => {
  let resolvedPath = executablePath;
  try {
    resolvedPath = realpathSync(executablePath);
  } catch {
    resolvedPath = executablePath;
  }

  return process.platform === "win32"
    ? path.win32.normalize(resolvedPath).toLowerCase()
    : resolvedPath;
};

const isCoreExecutable = (
  { exe, environ }: Shadps4ProcessIdentity,
  corePath: string | null
): boolean => {
  if (corePath === null) return true;

  const target = resolveExecutableIdentity(corePath);
  return [exe, environ?.APPIMAGE].some(
    (candidate) =>
      Boolean(candidate) &&
      resolveExecutableIdentity(candidate as string) === target
  );
};

export const findShadps4CorePid = (
  processes: ReadonlyArray<Shadps4ProcessIdentity>,
  parentPid: number,
  knownPids: ReadonlySet<number>,
  corePath: string | null
): number | null =>
  processes.find(
    (candidate) =>
      !knownPids.has(candidate.pid) &&
      !candidate.name.toLowerCase().includes("qtlauncher") &&
      isCoreExecutable(candidate, corePath) &&
      (process.platform !== "win32" || candidate.parentPid === parentPid)
  )?.pid ?? null;
