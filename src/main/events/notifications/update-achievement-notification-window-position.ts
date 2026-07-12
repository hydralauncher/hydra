import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";
import type { AchievementCustomNotificationPosition } from "@types";

const updateAchievementNotificationWindowPosition = async (
  _event: Electron.IpcMainInvokeEvent,
  position: AchievementCustomNotificationPosition,
  width?: number,
  height?: number
) => {
  await WindowManager.updateNotificationWindowPosition(position, width, height);
};

registerEvent(
  "updateAchievementNotificationWindowPosition",
  updateAchievementNotificationWindowPosition
);
