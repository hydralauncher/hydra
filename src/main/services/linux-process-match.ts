import fs from "node:fs";
import path from "node:path";

export interface LinuxProcessInfo {
  name: string;
  cwd: string;
  exe: string;
  pid: number;
  appImagePath: string | null;
  steamCompatDataPath: string | null;
}

type RealPathResolver = (value: string) => string;

type AsyncRealPathResolver = (value: string) => Promise<string>;

export const REAL_PATH_CACHE_TTL_MS = 30_000;

const realPathCache = new Map<
  string,
  { resolved: string; expiresAt: number }
>();
const pendingRealPaths = new Map<string, Promise<void>>();

const lookupCachedRealPath: RealPathResolver = (value) =>
  realPathCache.get(value)?.resolved ?? value;

export const clearExecutableRealPathCache = () => {
  realPathCache.clear();
  pendingRealPaths.clear();
};

const refreshRealPath = (
  value: string,
  resolve: AsyncRealPathResolver,
  now: number
) => {
  const cached = realPathCache.get(value);
  if (cached && cached.expiresAt > now) return undefined;

  const pending = pendingRealPaths.get(value);
  if (pending) return pending;

  const refresh = resolve(value)
    .catch(() => value)
    .then((resolved) => {
      realPathCache.set(value, {
        resolved,
        expiresAt: now + REAL_PATH_CACHE_TTL_MS,
      });
    })
    .finally(() => {
      pendingRealPaths.delete(value);
    });

  pendingRealPaths.set(value, refresh);
  return refresh;
};

export const refreshExecutableRealPaths = async (
  executablePaths: Iterable<string>,
  resolve: AsyncRealPathResolver = fs.promises.realpath,
  now = Date.now()
) => {
  const refreshes = new Set<Promise<void>>();

  for (const executablePath of new Set(executablePaths)) {
    const refresh = refreshRealPath(executablePath, resolve, now);
    if (refresh) refreshes.add(refresh);
  }

  await Promise.all(refreshes);
};

export const getExecutablePathAliases = (
  executablePath: string,
  resolve: RealPathResolver = lookupCachedRealPath
) => {
  const resolved = resolve(executablePath);

  return resolved === executablePath
    ? [executablePath]
    : [executablePath, resolved];
};

export const hasLinuxNativeOrAppImageMatch = (
  executablePath: string,
  linuxProcesses: LinuxProcessInfo[],
  resolve?: RealPathResolver
) => {
  const targets = new Set(
    getExecutablePathAliases(executablePath, resolve).map((alias) =>
      alias.toLowerCase()
    )
  );

  return linuxProcesses.some(
    (matchedProcess) =>
      targets.has(matchedProcess.exe) ||
      (matchedProcess.appImagePath !== null &&
        targets.has(matchedProcess.appImagePath))
  );
};

interface ProcessLocation {
  cwd?: string | null;
  exe?: string | null;
  appImagePath?: string | null;
}

interface LinuxWindowProcess extends ProcessLocation {
  pid: number;
  parentPid?: number | null;
  environ?: Record<string, string> | null;
}

export const processReferencesExecutable = (
  matchedProcess: ProcessLocation,
  executablePath: string,
  resolve?: RealPathResolver
) => {
  const aliases = getExecutablePathAliases(executablePath, resolve);
  const targets = new Set(aliases.map((alias) => alias.toLowerCase()));
  const gameDirectories = new Set(
    aliases.map((alias) => path.dirname(alias).toLowerCase())
  );

  return (
    gameDirectories.has((matchedProcess.cwd ?? "").toLowerCase()) ||
    targets.has((matchedProcess.exe ?? "").toLowerCase()) ||
    targets.has((matchedProcess.appImagePath ?? "").toLowerCase())
  );
};

export const hasLaunchedPidMatch = (
  launchedPid: number | undefined,
  executablePath: string,
  pidToProcess: Map<number, LinuxProcessInfo>,
  resolve?: RealPathResolver
) => {
  if (launchedPid === undefined) return false;

  const matchedProcess = pidToProcess.get(launchedPid);
  if (!matchedProcess) return false;

  return processReferencesExecutable(matchedProcess, executablePath, resolve);
};

export const doesSteamCompatDataPathMatchWinePrefix = (
  steamCompatDataPath: string | null | undefined,
  winePrefixPath: string | null | undefined
) => {
  if (!steamCompatDataPath || !winePrefixPath) return false;

  const compatDataPath = path.normalize(steamCompatDataPath).toLowerCase();
  const prefixPath = path.normalize(winePrefixPath).toLowerCase();

  return (
    compatDataPath === prefixPath ||
    path.join(compatDataPath, "pfx") === prefixPath
  );
};

const processMatchesWinePrefix = (
  process: LinuxWindowProcess,
  winePrefixPath: string | null | undefined
) => {
  if (!winePrefixPath) return false;

  const winePrefix = process.environ?.WINEPREFIX;
  const steamCompatDataPath = process.environ?.STEAM_COMPAT_DATA_PATH;
  const expectedPrefix = path.normalize(winePrefixPath).toLowerCase();

  return (
    Boolean(
      winePrefix && path.normalize(winePrefix).toLowerCase() === expectedPrefix
    ) ||
    doesSteamCompatDataPathMatchWinePrefix(steamCompatDataPath, winePrefixPath)
  );
};

export const isLinuxGameWindowProcess = (
  processes: LinuxWindowProcess[],
  activeProcessId: number,
  launchedProcessId: number | undefined,
  executablePaths: string[],
  winePrefixPath?: string | null
) => {
  const processById = new Map(
    processes.map((process) => [process.pid, process])
  );
  const visited = new Set<number>();
  let currentProcessId: number | null | undefined = activeProcessId;

  while (currentProcessId && !visited.has(currentProcessId)) {
    if (currentProcessId === launchedProcessId) return true;

    visited.add(currentProcessId);
    const process = processById.get(currentProcessId);
    if (!process) return false;

    if (
      executablePaths.some((executablePath) =>
        processReferencesExecutable(process, executablePath)
      ) ||
      processMatchesWinePrefix(process, winePrefixPath)
    ) {
      return true;
    }

    currentProcessId = process.parentPid;
  }

  return false;
};
