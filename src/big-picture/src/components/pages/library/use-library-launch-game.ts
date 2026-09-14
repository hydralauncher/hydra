import type { LibraryGame } from "@types";
import { useCallback } from "react";
import { getClassicsLaunchErrorCode } from "@renderer/helpers";
import { IS_DESKTOP } from "../../../constants";
import { NavigationAudioService } from "../../../services";
import { useBigPictureToast } from "../../../hooks";

const CLASSICS_LAUNCH_ERROR_TOASTS: Record<
  string,
  { title: string; message: string }
> = {
  RETROARCH_NOT_CONFIGURED: {
    title: "RetroArch not configured",
    message: "Configure RetroArch in Settings before launching this game.",
  },
  CORE_NOT_INSTALLED: {
    title: "Core not installed",
    message: "Download the RetroArch core for this platform in Settings.",
  },
  EMULATOR_NOT_CONFIGURED: {
    title: "Emulator not configured",
    message: "Configure the emulator for this platform in Settings.",
  },
  BIOS_NOT_CONFIGURED: {
    title: "BIOS not configured",
    message: "Add the BIOS files for this platform in Settings.",
  },
  NO_DISC: {
    title: "No disc found",
    message: "Add or rescan discs for this Classics game before launching.",
  },
};

export function useLibraryLaunchGame(
  onMissingExecutable: (game: LibraryGame) => void
) {
  const { showErrorToast } = useBigPictureToast();

  return useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP) return;

      if (game.shop === "launchbox") {
        if ((game.discs?.length ?? 0) === 0) {
          onMissingExecutable(game);
          return;
        }

        NavigationAudioService.getInstance().play("launch");
        try {
          await globalThis.window.electron.openClassicsGame(
            game.shop,
            game.objectId,
            game.selectedDiscPath ?? undefined
          );
          globalThis.window.dispatchEvent(new Event("library-update"));
        } catch (error) {
          const code = getClassicsLaunchErrorCode(error);
          const toast = (code && CLASSICS_LAUNCH_ERROR_TOASTS[code]) || {
            title: "Launch failed",
            message: "Hydra could not launch this Classics game.",
          };
          showErrorToast(toast.title, { message: toast.message });
        }
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
    [onMissingExecutable, showErrorToast]
  );
}
