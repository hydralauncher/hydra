import type { LibraryGame } from "@types";
import { useCallback, useState } from "react";
import { IS_DESKTOP } from "../../../constants";

export function useLibraryFavorite(updateLibrary: () => Promise<void>) {
  const [favoriteLoadingGameId, setFavoriteLoadingGameId] = useState<
    string | null
  >(null);

  const toggleFavorite = useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP) return;

      setFavoriteLoadingGameId(game.id);

      try {
        const toggle = game.favorite
          ? globalThis.window.electron.removeGameFromFavorites
          : globalThis.window.electron.addGameToFavorites;

        await toggle(game.shop, game.objectId);
        await updateLibrary();
      } finally {
        setFavoriteLoadingGameId(null);
      }
    },
    [updateLibrary]
  );

  return {
    favoriteLoadingGameId,
    toggleFavorite,
  };
}
