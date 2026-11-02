import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import { getGameExecutableFilters } from "@shared";
import { useAppSelector } from "./redux";
import { useLibrary } from "./use-library";
import { useToast } from "./use-toast";
import { logger } from "@renderer/logger";

export function useGameExecutablePicker() {
  const { t } = useTranslation("game_details");
  const { updateLibrary } = useLibrary();
  const { showErrorToast } = useToast();
  const downloadsPath = useAppSelector(
    (state) => state.userPreferences.value?.downloadsPath
  );

  return useCallback(
    async (shop: GameShop, objectId: string) => {
      try {
        const filters = getGameExecutableFilters(window.electron.platform, {
          executable: t("game_executable"),
          allFiles: t("all_files"),
        });

        const gameFolderPath = await window.electron
          .getExecutablePickerPath(shop, objectId)
          .catch(() => null);

        const { filePaths } = await window.electron.showOpenDialog({
          properties: ["openFile"],
          defaultPath:
            gameFolderPath ??
            downloadsPath ??
            (await window.electron.getDefaultDownloadsPath()),
          filters,
        });

        const executablePath = filePaths?.[0];
        if (!executablePath) return false;

        const gameUsingPath =
          await window.electron.verifyExecutablePathInUse(executablePath);

        const usedByAnotherGame =
          gameUsingPath &&
          (gameUsingPath.shop !== shop || gameUsingPath.objectId !== objectId);

        if (usedByAnotherGame) {
          showErrorToast(
            t("executable_path_in_use", { game: gameUsingPath.title })
          );
          return false;
        }

        await window.electron.updateExecutablePath(
          shop,
          objectId,
          executablePath
        );
        updateLibrary();
        return true;
      } catch (error) {
        logger.error("Failed to select the game executable", error);
        return false;
      }
    },
    [downloadsPath, showErrorToast, t, updateLibrary]
  );
}
