import type { ClassicsDisc } from "@types";

export const findSelectedExecutableDisc = (
  discs: ClassicsDisc[] | undefined,
  requestedPath: string | undefined,
  selectedDiscPath: string | null | undefined
) => {
  const chosenPath = requestedPath ?? selectedDiscPath ?? discs?.[0]?.path;
  if (!chosenPath) return null;

  const disc = discs?.find((candidate) => candidate.path === chosenPath);
  return disc?.isExecutable ? disc : null;
};

export const mergeScannedDiscs = (
  scannedDiscs: ClassicsDisc[],
  existingDiscs: ClassicsDisc[] | undefined
) => {
  const scannedPaths = new Set(scannedDiscs.map((disc) => disc.path));
  const keptExecutables = (existingDiscs ?? []).filter(
    (disc) => disc.isExecutable && !scannedPaths.has(disc.path)
  );

  return [...scannedDiscs, ...keptExecutables];
};
