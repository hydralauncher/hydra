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

export const publishNewRepacksNotifications = async (count: number) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  if (count > 0 && userPreferences?.repackUpdatesNotificationsEnabled) {
    new Notification({
      title: t("repack_list_updated", {
        ns: "notifications",
        lng: userPreferences?.language || "en",
      }),
      body: t("repack_count", {
        ns: "notifications",
        lng: userPreferences?.language || "en",
        count: count,
      }),
    }).show();
  }
};
