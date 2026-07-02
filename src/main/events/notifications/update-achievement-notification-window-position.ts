import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";
import type { AchievementCustomNotificationPosition } from "@types";

const updateAchievementNotificationWindowPosition = async (
  _event: Electron.IpcMainInvokeEvent,
  position: AchievementCustomNotificationPosition
) => {
  await WindowManager.updateNotificationWindowPosition(position);
};

registerEvent(
  "updateAchievementNotificationWindowPosition",
  updateAchievementNotificationWindowPosition
);
