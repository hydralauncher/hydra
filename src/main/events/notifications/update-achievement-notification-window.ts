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

  if (
    userPreferences.achievementNotificationsEnabled &&
    userPreferences.achievementCustomNotificationsEnabled !== false
  ) {
    WindowManager.createNotificationWindow();
  }
};

registerEvent(
  "updateAchievementCustomNotificationWindow",
  updateAchievementCustomNotificationWindow
);
