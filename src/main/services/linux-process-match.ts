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
  return linuxProcesses.some(
    (matchedProcess) =>
      matchedProcess.exe === executablePath ||
      matchedProcess.appImagePath === executablePath
  );
};

interface ProcessLocation {
  cwd?: string | null;
  exe?: string | null;
  appImagePath?: string | null;
}

export const processReferencesExecutable = (
  matchedProcess: ProcessLocation,
  executablePath: string,
  allowWorkingDirectoryMatch = false
) => {
  if (!executablePath) return false;
  const caseInsensitive = path.extname(executablePath).toLowerCase() === ".exe";
  const normalize = (value: string) =>
    caseInsensitive ? value.toLowerCase() : value;
  const target = normalize(executablePath);
  const gameDirectory = normalize(path.dirname(executablePath));

  return (
    (allowWorkingDirectoryMatch &&
      normalize(matchedProcess.cwd ?? "") === gameDirectory) ||
    normalize(matchedProcess.exe ?? "") === target ||
    normalize(matchedProcess.appImagePath ?? "") === target
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

  return processReferencesExecutable(matchedProcess, executablePath, true);
};
