import { Notification } from "electron";
import { t } from "i18next";
import { Game } from "@main/entity";
import { userPreferencesRepository } from "@main/repository";

export const publishDownloadCompleteNotification = async (game: Game) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  if (userPreferences?.downloadNotificationsEnabled) {
    new Notification({
      title: t("download_complete", {
        ns: "notifications",
        lng: userPreferences.language,
      }),
      body: t("game_ready_to_install", {
        ns: "notifications",
        lng: userPreferences.language,
        title: game.title,
      }),
    }).show();
  }
};
