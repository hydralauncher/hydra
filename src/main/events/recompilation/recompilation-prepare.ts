import type { RecompilationPrepareStep, RecompilationRomMeta } from "@types";

/** Reads one line a port's installer prints while it prepares the game. */
export const readInstallerEvent = (
  line: string,
  current: RecompilationPrepareStep
): RecompilationPrepareStep | null => {
  const step = /^@step (\d+) (\d+) (.+)$/.exec(line);
  if (step) {
    return { step: Number(step[1]), steps: Number(step[2]), title: step[3] };
  }
  const percent = /^@note (\d+)%/.exec(line);
  if (percent) return { ...current, percent: Number(percent[1]) };
  // Crash Bandicoot's --prepare prints "[ 35%] Recompile: ..."
  const stage = /^\[\s*(\d+)%\]\s+([^:]+):/.exec(line);
  if (stage) return { percent: Number(stage[1]), title: stage[2].trim() };
  return null;
};

// Ports prepared per version leave no marker file: the preparation recorded for
// this ROM and this installed version is what makes them ready.
export const isPreparedForVersion = (
  meta: Pick<RecompilationRomMeta, "prepareOnUpdate">,
  choice: { preparedFrom?: string; preparedVersion?: string } | null,
  romPath: string | null,
  installedVersion: string | undefined
) =>
  Boolean(meta.prepareOnUpdate) &&
  romPath !== null &&
  choice?.preparedFrom === romPath &&
  choice.preparedVersion === installedVersion;
