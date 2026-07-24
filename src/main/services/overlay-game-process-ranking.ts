import path from "node:path";

export type OverlayProcess = {
  exe: string | null;
  pid: number;
  name: string;
  startTime?: number;
};

export type OverlayProcessCandidate = OverlayProcess & { score: number };

const normalizePath = (value: string) => path.normalize(value).toLowerCase();

export const rankOverlayGameProcesses = (
  processes: OverlayProcess[],
  targets: string[],
  foregroundPid = 0
): OverlayProcessCandidate[] => {
  const normalizedTargets = targets.map(normalizePath);

  return processes
    .map((candidate): OverlayProcessCandidate | null => {
      const executable = candidate.exe ? normalizePath(candidate.exe) : null;
      const processName = candidate.name.toLowerCase();
      let score = 0;

      for (const [index, target] of normalizedTargets.entries()) {
        const targetName = path.basename(target);
        if (executable === target) {
          score = Math.max(score, 10_000 - index * 10);
        } else if (executable && path.basename(executable) === targetName) {
          score = Math.max(score, 2_000 - index * 10);
        } else if (processName === targetName) {
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
