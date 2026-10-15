import { createSelector } from "@reduxjs/toolkit";
import type { LibraryGame, LibraryGamePresentation } from "@types";
import { groupLibraryGames } from "../../../shared/library-catalogue.js";

interface LibraryPresentationState {
  library: { downloadLibrary: LibraryGame[] };
  gameRunning: { gameRunning: { id: string } | null };
}

/** All visible rows and their menus share one projection per library update. */
export const selectLibraryPresentationIndex = createSelector(
  [
    (state: LibraryPresentationState) => state.library.downloadLibrary,
    (state: LibraryPresentationState) => state.gameRunning.gameRunning?.id,
  ],
  (library, runningId) => {
    const owned = new Map<string, LibraryGamePresentation>();
    const catalogue = new Map<string, LibraryGamePresentation | null>();
    for (const group of groupLibraryGames(
      library,
      runningId ? [runningId] : []
    )) {
      for (const member of group.members) {
        owned.set(`${member.shop}:${member.objectId}`, group);
      }
      const key = `${group.catalogueGame.shop}:${group.catalogueGame.objectId}`;
      catalogue.set(key, catalogue.has(key) ? null : group);
    }
    return { owned, catalogue };
  }
);
