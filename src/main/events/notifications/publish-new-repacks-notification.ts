import { Notification } from "electron";
import { registerEvent } from "../register-event";
import { t } from "i18next";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const publishNewRepacksNotification = async (
  _event: Electron.IpcMainInvokeEvent,
  newRepacksCount: number
) => {
  if (newRepacksCount < 1) return;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

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
