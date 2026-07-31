import type { ClassicsDisc } from "@types";

import { isWithin } from "../emulators/rom-path-utils";

export interface DiscReconciliation {
  discs: ClassicsDisc[];
  selectedDiscPath: string | null | undefined;
  isDeleted: boolean;
}

/**
 * Works out what survives when a ROM folder is removed.
 *
 * A title can straddle folders — Disc 1 under the removed one, Disc 2 under a
 * folder that stays — so uncovered discs are dropped one by one and the game is
 * marked deleted only once nothing is left. A selection pointing at a dropped
 * disc is moved to a surviving one, otherwise launch would keep using a path
 * that no longer resolves.
 *
 * Returns null when the title needs no write.
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
  if (coveredDiscs.length === discs.length) return null;

  if (coveredDiscs.length === 0) {
    return { discs, selectedDiscPath, isDeleted: true };
  }

  const selectionSurvived = coveredDiscs.some(
    (disc) => disc.path === selectedDiscPath
  );

  return {
    discs: coveredDiscs,
    selectedDiscPath:
      selectedDiscPath && !selectionSurvived
        ? coveredDiscs[0].path
        : selectedDiscPath,
    isDeleted: false,
  };
};
