import type { ClassicsDisc } from "@types";

const findChosenDisc = (
  discs: ClassicsDisc[] | undefined,
  requestedPath: string | undefined,
  selectedDiscPath: string | null | undefined
) => {
  const chosenPath = requestedPath ?? selectedDiscPath ?? discs?.[0]?.path;
  if (!chosenPath) return null;

  return discs?.find((candidate) => candidate.path === chosenPath) ?? null;
};

export const findSelectedExecutableDisc = (
  discs: ClassicsDisc[] | undefined,
  requestedPath: string | undefined,
  selectedDiscPath: string | null | undefined
) => {
  const disc = findChosenDisc(discs, requestedPath, selectedDiscPath);
  return disc?.isExecutable ? disc : null;
};

export const findSelectedRecompilationDisc = (
  discs: ClassicsDisc[] | undefined,
  requestedPath: string | undefined,
  selectedDiscPath: string | null | undefined
) => {
  const disc = findChosenDisc(discs, requestedPath, selectedDiscPath);
  return disc?.recompilationSlug ? disc : null;
};

export const mergeScannedDiscs = (
  scannedDiscs: ClassicsDisc[],
  existingDiscs: ClassicsDisc[] | undefined
) => {
  const scannedPaths = new Set(scannedDiscs.map((disc) => disc.path));
  const keptDiscs = (existingDiscs ?? []).filter(
    (disc) =>
      (disc.isExecutable || disc.recompilationSlug) &&
      !scannedPaths.has(disc.path)
  );

  return [...scannedDiscs, ...keptDiscs];
};
