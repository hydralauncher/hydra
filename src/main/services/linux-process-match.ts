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

export const hasLaunchedPidMatch = (
  launchedPid: number | undefined,
  executablePath: string,
  pidToProcess: Map<number, LinuxProcessInfo>
) => {
  if (launchedPid === undefined) return false;

  const matchedProcess = pidToProcess.get(launchedPid);
  if (!matchedProcess) return false;

  const target = executablePath.toLowerCase();
  const gameDirectory = path.dirname(executablePath).toLowerCase();

  return (
    matchedProcess.cwd === gameDirectory ||
    matchedProcess.exe === target ||
    matchedProcess.appImagePath === target
  );
};
