import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const openAchievementNotificationCustomizerWindow = async () => {
  WindowManager.openAchievementNotificationCustomizerWindow();
};

registerEvent(
  "openAchievementNotificationCustomizerWindow",
  openAchievementNotificationCustomizerWindow
);
