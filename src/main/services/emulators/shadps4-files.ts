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

const PORTABLE_USER_DIR = "user";
const LOG_DIR = "log";
const LOG_READ_LIMIT_BYTES = 64 * 1024;
const LOG_EXTENSIONS = new Set([".log", ".txt"]);
const LOG_VERSION_RE = /Starting shadps4 emulator v(\S+)/;
const RELEASE_VERSION_RE = /\d+\.\d+(?:\.\d+)?/;
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

interface Shadps4ProcessIdentity {
  pid: number;
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

const isSameExecutable = (
  { exe, environ }: Shadps4ProcessIdentity,
  executablePath: string
): boolean => {
  const target = resolveExecutableIdentity(executablePath);

  return [exe, environ?.APPIMAGE].some(
    (candidate) =>
      Boolean(candidate) &&
      resolveExecutableIdentity(candidate as string) === target
  );
};

export const findNewShadps4Pid = (
  processes: ReadonlyArray<Shadps4ProcessIdentity>,
  knownPids: ReadonlySet<number>,
  executablePath: string
): number | null =>
  processes.find(
    (candidate) =>
      !knownPids.has(candidate.pid) &&
      isSameExecutable(candidate, executablePath)
  )?.pid ?? null;
