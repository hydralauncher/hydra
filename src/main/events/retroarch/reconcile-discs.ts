import type { ClassicsDisc } from "@types";

import { isWithin } from "../emulators/rom-path-utils";

export interface DiscReconciliation {
  discs: ClassicsDisc[];
  selectedDiscPath: string | null | undefined;
  isDeleted: boolean;
}

const buildReconciliation = (
  discs: ClassicsDisc[],
  survivingDiscs: ClassicsDisc[],
  selectedDiscPath: string | null | undefined
): DiscReconciliation | null => {
  if (survivingDiscs.length === discs.length) return null;

  if (survivingDiscs.length === 0) {
    return { discs, selectedDiscPath, isDeleted: true };
  }

  const selectionSurvived = survivingDiscs.some(
    (disc) => disc.path === selectedDiscPath
  );

  return {
    discs: survivingDiscs,
    selectedDiscPath:
      selectedDiscPath && !selectionSurvived
        ? survivingDiscs[0].path
        : selectedDiscPath,
    isDeleted: false,
  };
};

export const reconcileDiscsForRemovedFolder = (
  discs: ClassicsDisc[],
  selectedDiscPath: string | null | undefined,
  removedPath: string,
  remainingFolderPaths: string[]
): DiscReconciliation | null => {
  if (discs.length === 0) return null;

  const underRemoved = discs.some((disc) => isWithin(disc.path, removedPath));
  if (!underRemoved) return null;

  const coveredDiscs = discs.filter((disc) =>
    remainingFolderPaths.some((folder) => isWithin(disc.path, folder))
  );

  return buildReconciliation(discs, coveredDiscs, selectedDiscPath);
};

export const reconcileDiscsAfterScan = (
  discs: ClassicsDisc[],
  selectedDiscPath: string | null | undefined,
  scannedFolderPaths: string[],
  discExists: (discPath: string) => boolean
): DiscReconciliation | null => {
  if (discs.length === 0) return null;

  const wasScanned = (disc: ClassicsDisc) =>
    scannedFolderPaths.some((folder) => isWithin(disc.path, folder));

  if (!discs.some(wasScanned)) return null;

  const survivingDiscs = discs.filter(
    (disc) => !wasScanned(disc) || discExists(disc.path)
  );

  return buildReconciliation(discs, survivingDiscs, selectedDiscPath);
};
