import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";
import { UserPreferences } from "@types";

const updateAchievementCustomNotificationWindow = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  WindowManager.closeNotificationWindow();

  const achievementCustomEnabled =
    userPreferences.achievementNotificationsEnabled !== false &&
    userPreferences.achievementCustomNotificationsEnabled !== false;

  const friendCustomEnabled =
    userPreferences.friendStartGameNotificationsEnabled !== false &&
    userPreferences.friendStartGameCustomNotificationsEnabled !== false;

  if (achievementCustomEnabled || friendCustomEnabled) {
    WindowManager.createNotificationWindow();
  }
};

registerEvent(
  "updateAchievementCustomNotificationWindow",
  updateAchievementCustomNotificationWindow
);
