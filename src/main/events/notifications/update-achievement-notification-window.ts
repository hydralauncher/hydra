import { registerEvent } from "../register-event";
import { achievementNotificationPresenter } from "@main/services";

const updateAchievementCustomNotificationWindow = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  achievementNotificationPresenter.dispose();
};

registerEvent(
  "updateAchievementCustomNotificationWindow",
  updateAchievementCustomNotificationWindow
);
