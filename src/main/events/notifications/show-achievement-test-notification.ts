import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const showAchievementTestNotification = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  setTimeout(() => {
    WindowManager.showAchievementTestNotification();
  }, 1000);
};

registerEvent(
  "showAchievementTestNotification",
  showAchievementTestNotification
);
