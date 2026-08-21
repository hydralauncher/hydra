import type { ProcessPayload } from "./download/types";

const normalizeWindowsExecutablePath = (value: string) =>
  value
    .trim()
    .replace(/^\\\\\?\\/, "")
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();

export const isWindowsGameForegroundProcess = (
  processes: Pick<ProcessPayload, "exe" | "pid" | "parentPid">[],
  foregroundProcessId: number,
  launchedProcessId: number | undefined,
  executablePaths: string[]
) => {
  const processById = new Map(
    processes.map((candidate) => [candidate.pid, candidate])
  );
  const normalizedExecutablePaths = new Set(
    executablePaths.map(normalizeWindowsExecutablePath)
  );
  const visited = new Set<number>();
  let currentProcessId: number | null | undefined = foregroundProcessId;

  while (currentProcessId != null && !visited.has(currentProcessId)) {
    if (currentProcessId === launchedProcessId) return true;

    visited.add(currentProcessId);
    const currentProcess = processById.get(currentProcessId);
    if (!currentProcess) return false;

    if (
      currentProcess.exe &&
      normalizedExecutablePaths.has(
        normalizeWindowsExecutablePath(currentProcess.exe)
      )
    ) {
      return true;
    }

    currentProcessId = currentProcess.parentPid;
  }

  return false;
};

const normalizeWindowsHandle = (value: string) => {
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
};

export const isWindowsWindowSource = (
  sourceId: string,
  windowHandle: string
) => {
  const match = /^window:([^:]+):/.exec(sourceId);

  return (
    match !== null &&
    normalizeWindowsHandle(match[1]) === normalizeWindowsHandle(windowHandle)
  );
};
