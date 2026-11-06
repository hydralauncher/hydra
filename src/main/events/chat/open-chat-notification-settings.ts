import { WindowManager } from "@main/services";
import { ipcMain } from "electron";

// The chat window has no settings of its own; the main window's notifications
// page covers chat messages too.
ipcMain.handle("openChatNotificationSettings", () => {
  WindowManager.focusMainWindowAndNavigate("/settings?tab=notifications");
});
