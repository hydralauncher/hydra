import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";

const deleteAllCustomThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  await themesSublevel.clear();

  WindowManager.sendToAppWindows("on-custom-theme-updated");
  achievementNotificationPresenter.notifyThemeUpdated();
};

registerEvent("deleteAllCustomThemes", deleteAllCustomThemes);
