import { useMemo } from "react";
import type { GameShop, LibraryGame } from "@types";
import {
  findLibraryGamePresentation,
  mergeLibraryCatalogueMetadata,
} from "@shared";
import { useLibrary } from "./use-library";
import { useAppSelector } from "./redux";
import { selectLibraryPresentationIndex } from "../features/library-presentation";

export function useLibraryGamePresentation(
  { shop, objectId }: { shop: GameShop; objectId: string },
  currentGame?: LibraryGame | null
) {
  const { downloadLibrary } = useLibrary();
  const runningGame = useAppSelector((state) => state.gameRunning.gameRunning);
  const runningId = runningGame?.id;
  const index = useAppSelector(selectLibraryPresentationIndex);
  return useMemo(() => {
    if (!currentGame) {
      const key = `${shop}:${objectId}`;
      return index.owned.get(key) ?? index.catalogue.get(key) ?? undefined;
    }
    const games = downloadLibrary.map((cached) => {
      if (
        !currentGame ||
        cached.shop !== currentGame.shop ||
        cached.objectId !== currentGame.objectId ||
        cached.remoteId !== currentGame.remoteId ||
        cached.hasActiveEpicImport !== currentGame.hasActiveEpicImport ||
        cached.hasActiveSteamImport !== currentGame.hasActiveSteamImport ||
        JSON.stringify(cached.epicImportScope) !==
          JSON.stringify(currentGame.epicImportScope)
      ) {
        return cached;
      }
      return {
        ...cached,
        ...currentGame,
        ...mergeLibraryCatalogueMetadata(currentGame, cached),
        download: cached.download,
        title: cached.title,
        iconUrl: cached.iconUrl,
        logoImageUrl: cached.logoImageUrl,
        libraryHeroImageUrl: cached.libraryHeroImageUrl,
        libraryImageUrl: cached.libraryImageUrl,
        coverImageUrl: cached.coverImageUrl,
        logoPosition: cached.logoPosition,
        favorite: cached.favorite,
        isPinned: cached.isPinned,
        collectionIds: cached.collectionIds,
        isHiddenFromOthers: cached.isHiddenFromOthers,
        isConcealed: cached.isConcealed,
        isDeleted: cached.isDeleted,
      };
    });
    return findLibraryGamePresentation(
      games,
      { shop, objectId },
      runningId ? [runningId] : []
    );
  }, [downloadLibrary, shop, objectId, runningId, currentGame, index]);
}
