import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const closeAchievementNotificationCustomizerWindow = async (
  _event: Electron.IpcMainInvokeEvent,
  force?: boolean
) => {
  WindowManager.closeAchievementNotificationCustomizerWindow(force);
};

registerEvent(
  "closeAchievementNotificationCustomizerWindow",
  closeAchievementNotificationCustomizerWindow
);
