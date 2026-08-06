import path from "node:path";

export type WindowsProcessInfo = {
  name: string;
  exe: string | null;
  pid: number;
};

export const hasWindowsVisibleProcessMatch = (
  executablePaths: string[],
  processes: WindowsProcessInfo[],
  hasVisibleWindow: (pid: number) => boolean
) => {
  const normalizedPaths = new Set(
    executablePaths.map((value) => path.win32.normalize(value).toLowerCase())
  );
  const executableNames = new Set(
    executablePaths.map((value) => path.win32.basename(value).toLowerCase())
  );
  return processes.some(
    (candidate) =>
      executableNames.has(candidate.name.toLowerCase()) &&
      (!candidate.exe ||
        normalizedPaths.has(
          path.win32.normalize(candidate.exe).toLowerCase()
        )) &&
      hasVisibleWindow(candidate.pid)
  );
};
