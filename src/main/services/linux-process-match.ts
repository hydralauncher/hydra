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

export const resolveExecutableRealPath = async (
  value: string,
  realpath: AsyncRealPathResolver = fs.promises.realpath
) =>
  path.posix.join(
    await realpath(path.posix.dirname(value)),
    path.posix.basename(value)
  );

const resolveDirectoryRealPath: AsyncRealPathResolver = (value) =>
  fs.promises.realpath(value);

const createRealPathCache = (defaultResolve: AsyncRealPathResolver) => {
  const entries = new Map<string, { resolved: string; expiresAt: number }>();
  const pending = new Map<string, Promise<void>>();

  const lookup: RealPathResolver = (value) =>
    entries.get(value)?.resolved ?? value;

  const clear = () => {
    entries.clear();
    pending.clear();
  };

  const start = (
    value: string,
    resolve: AsyncRealPathResolver,
    now: number
  ) => {
    const refresh = resolve(value)
      .catch(() => entries.get(value)?.resolved ?? value)
      .then((resolved) => {
        entries.set(value, {
          resolved,
          expiresAt: now + REAL_PATH_CACHE_TTL_MS,
        });
      })
      .finally(() => {
        pending.delete(value);
      });

    pending.set(value, refresh);
    return refresh;
  };

  const refreshOne = (
    value: string,
    resolve: AsyncRealPathResolver,
    now: number
  ): Promise<void> => {
    const cached = entries.get(value);
    if (cached && cached.expiresAt > now) return Promise.resolve();

    return pending.get(value) ?? start(value, resolve, now);
  };

  const refresh = async (
    values: Iterable<string>,
    resolve: AsyncRealPathResolver = defaultResolve,
    now = Date.now()
  ) => {
    const refreshes = new Set<Promise<void>>();

    for (const value of new Set(values)) {
      refreshes.add(refreshOne(value, resolve, now));
    }

    await Promise.all(refreshes);
  };

  return { lookup, clear, refresh };
};

const executableRealPaths = createRealPathCache(resolveExecutableRealPath);
const winePrefixRealPaths = createRealPathCache(resolveDirectoryRealPath);

export const clearExecutableRealPathCache = () => {
  executableRealPaths.clear();
  winePrefixRealPaths.clear();
};

export const refreshExecutableRealPaths = executableRealPaths.refresh;

export const refreshWinePrefixRealPaths = winePrefixRealPaths.refresh;

const toAliases = (value: string, resolved: string) =>
  resolved === value ? [value] : [value, resolved];

export const getExecutablePathAliases = (
  executablePath: string,
  resolve: RealPathResolver = executableRealPaths.lookup
) => toAliases(executablePath, resolve(executablePath));

export const getWinePrefixAliases = (
  winePrefixPath: string,
  resolve: RealPathResolver = winePrefixRealPaths.lookup
) => toAliases(winePrefixPath, resolve(winePrefixPath));

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

  return getWinePrefixAliases(winePrefixPath).some((alias) => {
    const expectedPrefix = path.normalize(alias).toLowerCase();

    return (
      Boolean(
        winePrefix &&
          path.normalize(winePrefix).toLowerCase() === expectedPrefix
      ) || doesSteamCompatDataPathMatchWinePrefix(steamCompatDataPath, alias)
    );
  });
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
