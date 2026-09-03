import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";
import { db, levelKeys } from "@main/level";
import { generateAchievementCustomNotificationTest } from "@shared";
import type { UserPreferences } from "@types";
import { t } from "i18next";

const showAchievementTestNotification = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );
  const language = userPreferences.language ?? "en";
  const position =
    userPreferences.achievementCustomNotificationPosition ?? "top-left";
  const testAchievements = [
    generateAchievementCustomNotificationTest(t, language),
    generateAchievementCustomNotificationTest(t, language, {
      isRare: true,
      isHidden: true,
    }),
    generateAchievementCustomNotificationTest(t, language, {
      isPlatinum: true,
    }),
  ];

  setTimeout(() => {
    if (process.platform === "linux") {
      WindowManager.sendAchievementToFocusedWindow(position, testAchievements);
      return;
    }

    if (process.platform === "win32") {
      achievementNotificationPresenter.enqueueAchievements(
        position,
        testAchievements
      );
    }
  }, 1000);
};

registerEvent(
  "showAchievementTestNotification",
  showAchievementTestNotification
);
