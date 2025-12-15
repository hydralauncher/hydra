import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLibrary, useToast } from "./";
import { logger } from "@renderer/logger";

export const useSteamLibraryUpdate = () => {
  const { updateLibrary } = useLibrary();
  const { showSuccessToast } = useToast();
  const { t } = useTranslation("sidebar");

  useEffect(() => {
    const unlisten = window.electron.onSteamLibraryUpdated((data) => {
      logger.log(
        `Steam library updated: ${data.newGamesCount} new games, ${data.removedGamesCount} removed`
      );

      updateLibrary();

      if (data.newGamesCount > 0 || data.removedGamesCount > 0) {
        showSuccessToast(
          t("steam_library_updated", { count: data.newGamesCount }) ||
            `${data.newGamesCount} new game(s) imported`
        );
      } else {
        showSuccessToast(
          t("steam_library_up_to_date") || "Steam library is up to date"
        );
      }
    });

    return () => unlisten();
  }, [updateLibrary, showSuccessToast, t]);
};

