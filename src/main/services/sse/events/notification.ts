import type { Notification } from "../types";
import { WindowManager } from "@main/services/window-manager";

export const notificationEvent = (payload: Notification) => {
  // Broadcast to every window (the big picture window has its own listener).
  WindowManager.sendToAppWindows("on-sync-notification-count", {
    notificationCount: payload.notificationCount,
  });
};
