import { Notification } from "electron";
import { registerEvent } from "../register-event";
import { userPreferencesRepository } from "@main/repository";
import { t } from "i18next";

const publishNewRepacksNotification = async (
  _event: Electron.IpcMainInvokeEvent,
  newRepacksCount: number
) => {
  if (newRepacksCount < 1) return;

  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  if (userPreferences?.repackUpdatesNotificationsEnabled) {
    new Notification({
      title: t("repack_list_updated", {
        ns: "notifications",
      }),
      body: t("repack_count", {
        ns: "notifications",
        count: newRepacksCount,
      }),
    }).show();
  }
};

registerEvent("publishNewRepacksNotification", publishNewRepacksNotification);
