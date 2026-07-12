import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";
import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationVariation,
} from "@types";

const showAchievementTestNotification = async (
  _event: Electron.IpcMainInvokeEvent,
  variation?: AchievementNotificationVariation,
  position?: AchievementCustomNotificationPosition
) => {
  await WindowManager.showAchievementTestNotification(variation, position);
};

registerEvent(
  "showAchievementTestNotification",
  showAchievementTestNotification
);
