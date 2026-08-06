import path from "node:path";

export type OverlayProcess = {
  exe: string | null;
  pid: number;
  name: string;
  startTime?: number;
};

export type OverlayProcessCandidate = OverlayProcess & { score: number };

const normalizePath = (value: string, caseInsensitive: boolean) => {
  const normalized = path.posix.normalize(
    value.replaceAll(path.win32.sep, path.posix.sep)
  );
  return caseInsensitive ? normalized.toLowerCase() : normalized;
};

const getPathName = (value: string) => path.posix.basename(value);

export const rankOverlayGameProcesses = (
  processes: OverlayProcess[],
  targets: string[],
  foregroundPid = 0,
  platform: NodeJS.Platform = process.platform
): OverlayProcessCandidate[] => {
  return processes
    .map((candidate): OverlayProcessCandidate | null => {
      let score = 0;

      for (const [index, rawTarget] of targets.entries()) {
        const caseInsensitive =
          platform === "win32" || rawTarget.toLowerCase().endsWith(".exe");
        const target = normalizePath(rawTarget, caseInsensitive);
        const targetName = getPathName(target);
        const executable = candidate.exe
          ? normalizePath(candidate.exe, caseInsensitive)
          : null;
        const processName = caseInsensitive
          ? candidate.name.toLowerCase()
          : candidate.name;
        if (executable === target) {
          score = Math.max(score, 10_000 - index * 10);
        } else if (
          platform !== "win32" &&
          executable &&
          getPathName(executable) === targetName
        ) {
          score = Math.max(score, 2_000 - index * 10);
        } else if (
          processName === targetName &&
          (platform !== "win32" || !executable)
        ) {
          score = Math.max(score, 1_500 - index * 10);
        }
      }

      if (score === 0) return null;
      if (candidate.pid === foregroundPid) score += 750;

      return { ...candidate, score };
    })
    .filter((candidate): candidate is OverlayProcessCandidate => !!candidate)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.startTime ?? 0) - (left.startTime ?? 0) ||
        right.pid - left.pid
    );
};

export const prioritizeVisibleOverlayProcesses = (
  candidates: OverlayProcessCandidate[],
  visiblePids: ReadonlySet<number>
) =>
  candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        Number(visiblePids.has(right.candidate.pid)) -
          Number(visiblePids.has(left.candidate.pid)) ||
        left.index - right.index
    )
    .map(({ candidate }) => candidate);
