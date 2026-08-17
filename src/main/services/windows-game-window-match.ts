import type { ProcessPayload } from "./download/types";

const normalizeWindowsExecutablePath = (value: string) =>
  value
    .trim()
    .replace(/^\\\\\?\\/, "")
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();

export const isWindowsGameForegroundProcess = (
  processes: Pick<ProcessPayload, "exe" | "pid">[],
  foregroundProcessId: number,
  launchedProcessId: number | undefined,
  executablePaths: string[]
) => {
  if (launchedProcessId !== undefined) {
    return foregroundProcessId === launchedProcessId;
  }

  const foregroundProcess = processes.find(
    (candidate) => candidate.pid === foregroundProcessId
  );
  if (!foregroundProcess?.exe) return false;

  const foregroundExecutable = normalizeWindowsExecutablePath(
    foregroundProcess.exe
  );

  return executablePaths.some(
    (executablePath) =>
      normalizeWindowsExecutablePath(executablePath) === foregroundExecutable
  );
};
