import type { AchievementNotificationCustomizer } from "@types";
import { themesSublevel } from "@main/level";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const updateAchievementNotificationProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  payload: {
    name: string;
    customizer: AchievementNotificationCustomizer;
    achievementNotificationCustomizerActive?: boolean;
  }
) => {
  const theme = await themesSublevel.get(themeId);

  if (!theme) {
    throw new Error("Theme not found");
  }

  if (payload.achievementNotificationCustomizerActive) {
    const allThemes = await themesSublevel.values().all();
    await Promise.all(
      allThemes
        .filter(
          (currentTheme) =>
            currentTheme.id !== themeId &&
            currentTheme.achievementNotificationCustomizerActive
        )
        .map((currentTheme) =>
          themesSublevel.put(currentTheme.id, {
            ...currentTheme,
            achievementNotificationCustomizerActive: false,
            updatedAt: new Date(),
          })
        )
    );
  }

  await themesSublevel.put(themeId, {
    ...theme,
    name: payload.name.trim() || theme.name,
    achievementNotificationCustomizer: payload.customizer,
    achievementNotificationCustomizerActive:
      payload.achievementNotificationCustomizerActive ??
      theme.achievementNotificationCustomizerActive,
    updatedAt: new Date(),
  });

  WindowManager.notificationWindow?.webContents.send("on-custom-theme-updated");
  WindowManager.mainWindow?.webContents.send("on-custom-theme-updated");
};

registerEvent(
  "updateAchievementNotificationProfile",
  updateAchievementNotificationProfile
);
