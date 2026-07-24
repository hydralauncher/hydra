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
  const executableNames = new Set(
    executablePaths.map((value) => path.win32.basename(value).toLowerCase())
  );
  return processes.some(
    (candidate) =>
      executableNames.has(candidate.name.toLowerCase()) &&
      hasVisibleWindow(candidate.pid)
  );
};
