import type { LibraryGame } from "@types";
import { useCallback, useState } from "react";
import { IS_DESKTOP } from "../../../constants";
import {
  buildFavoriteToastOptions,
  buildGameToastVisualOptions,
} from "../../../helpers";
import { useBigPictureToast } from "../../../hooks";

export function useLibraryFavorite(updateLibrary: () => Promise<void>) {
  const [favoriteLoadingGameId, setFavoriteLoadingGameId] = useState<
    string | null
  >(null);
  const { showSuccessToast, showErrorToast } = useBigPictureToast();

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
        globalThis.window.dispatchEvent(new Event("library-update"));
        const { title, ...toastOptions } = await buildFavoriteToastOptions(
          game,
          game.favorite ? "removed" : "added"
        );
        showSuccessToast(title, toastOptions);
      } catch {
        const toastOptions = await buildGameToastVisualOptions(game);
        showErrorToast("Failed to update favorites", {
          ...toastOptions,
          message: `${game.title} couldn't be updated right now.`,
        });
      } finally {
        setFavoriteLoadingGameId(null);
      }
    },
    [showErrorToast, showSuccessToast, updateLibrary]
  );

  return {
    favoriteLoadingGameId,
    toggleFavorite,
  };
}
