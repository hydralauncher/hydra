import path from "node:path";

export interface LinuxProcessInfo {
  name: string;
  cwd: string;
  exe: string;
  pid: number;
  appImagePath: string | null;
  steamCompatDataPath: string | null;
}

export const hasLinuxNativeOrAppImageMatch = (
  executablePath: string,
  linuxProcesses: LinuxProcessInfo[]
) => {
  const target = executablePath.toLowerCase();

  return linuxProcesses.some(
    (matchedProcess) =>
      matchedProcess.exe === target || matchedProcess.appImagePath === target
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
  executablePath: string
) => {
  const target = executablePath.toLowerCase();
  const gameDirectory = path.dirname(executablePath).toLowerCase();

  return (
    (matchedProcess.cwd ?? "").toLowerCase() === gameDirectory ||
    (matchedProcess.exe ?? "").toLowerCase() === target ||
    (matchedProcess.appImagePath ?? "").toLowerCase() === target
  );
};

export const hasLaunchedPidMatch = (
  launchedPid: number | undefined,
  executablePath: string,
  pidToProcess: Map<number, LinuxProcessInfo>
) => {
  if (launchedPid === undefined) return false;

  const matchedProcess = pidToProcess.get(launchedPid);
  if (!matchedProcess) return false;

  return processReferencesExecutable(matchedProcess, executablePath);
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
