import type { Notification } from "@main/generated/envelope";
import { WindowManager } from "@main/services/window-manager";

export const notificationEvent = (payload: Notification) => {
  WindowManager.mainWindow?.webContents.send("on-sync-notification-count", {
    notificationCount: payload.notificationCount,
  });
};
