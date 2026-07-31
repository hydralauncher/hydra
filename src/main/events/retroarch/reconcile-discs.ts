import type { ClassicsDisc } from "@types";

import { isWithin } from "../emulators/rom-path-utils";

export interface DiscReconciliation {
  discs: ClassicsDisc[];
  selectedDiscPath: string | null | undefined;
  isDeleted: boolean;
}

/**
 * Turns a surviving subset of discs into the update to persist.
 *
 * A selection pointing at a dropped disc is moved to a surviving one, otherwise
 * launch would keep using a path that no longer resolves. Returns null when
 * nothing was dropped and the title needs no write.
 */
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

/**
 * Works out what survives when a ROM folder is removed.
 *
 * A title can straddle folders — Disc 1 under the removed one, Disc 2 under a
 * folder that stays — so uncovered discs are dropped one by one and the game is
 * marked deleted only once nothing is left.
 */
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

/**
 * Works out what survives after a scan, once files have gone missing from disk.
 *
 * Only discs inside the scanned folders are checked: this scan says nothing
 * about files elsewhere, so those are left attached. As with folder removal, a
 * title keeps its remaining discs and is deleted only when every disc is gone.
 */
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
