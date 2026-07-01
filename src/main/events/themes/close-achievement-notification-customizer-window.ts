import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const closeAchievementNotificationCustomizerWindow = async () => {
  WindowManager.closeAchievementNotificationCustomizerWindow();
};

registerEvent(
  "closeAchievementNotificationCustomizerWindow",
  closeAchievementNotificationCustomizerWindow
);
