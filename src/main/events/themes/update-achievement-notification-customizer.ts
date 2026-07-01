import type { AchievementNotificationCustomizer } from "@types";
import { themesSublevel } from "@main/level";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const updateAchievementNotificationCustomizer = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  customizer: AchievementNotificationCustomizer
) => {
  const theme = await themesSublevel.get(themeId);

  if (!theme) {
    throw new Error("Theme not found");
  }

  await themesSublevel.put(themeId, {
    ...theme,
    achievementNotificationCustomizer: customizer,
    updatedAt: new Date(),
  });

  WindowManager.notificationWindow?.webContents.send("on-custom-theme-updated");
  WindowManager.mainWindow?.webContents.send("on-custom-theme-updated");
};

registerEvent(
  "updateAchievementNotificationCustomizer",
  updateAchievementNotificationCustomizer
);
