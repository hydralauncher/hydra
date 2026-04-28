import type { LibraryGame } from "@types";
import { useCallback } from "react";
import { IS_DESKTOP } from "../../../constants";

export function useLibraryLaunchGame(
  onMissingExecutable: (game: LibraryGame) => void
) {
  return useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP) return;

      if (!game.executablePath) {
        onMissingExecutable(game);
        return;
      }

      await globalThis.window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath,
        game.launchOptions
      );
    },
    [onMissingExecutable]
  );
}
