import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const updateAchievementCustomNotificationWindowPosition = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  const { x, y } = await WindowManager.getNotificationWindowPosition();

  WindowManager.notificationWindow?.setPosition(x, y);

  WindowManager.notificationWindow?.webContents.send(
    "on-test-achievement-notification"
  );
};

registerEvent(
  "updateAchievementCustomNotificationWindowPosition",
  updateAchievementCustomNotificationWindowPosition
);
