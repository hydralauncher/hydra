import type { LibraryGame } from "@types";
import { useCallback } from "react";
import { IS_DESKTOP } from "../../../constants";
import { NavigationAudioService } from "../../../services";

export function useLibraryLaunchGame(
  onMissingExecutable: (game: LibraryGame) => void
) {
  return useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP) return;

      if (game.shop === "launchbox") {
        if ((game.discs?.length ?? 0) === 0) {
          onMissingExecutable(game);
          return;
        }

        NavigationAudioService.getInstance().play("launch");
        await globalThis.window.electron.openClassicsGame(
          game.shop,
          game.objectId,
          game.selectedDiscPath ?? undefined
        );
        globalThis.window.dispatchEvent(new Event("library-update"));
        return;
      }

      if (!game.executablePath) {
        onMissingExecutable(game);
        return;
      }

      NavigationAudioService.getInstance().play("launch");
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
