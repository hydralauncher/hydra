import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";

const deleteAllCustomThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  await themesSublevel.clear();

  WindowManager.notifyCustomThemeUpdated();
  achievementNotificationPresenter.notifyThemeUpdated();
};

registerEvent("deleteAllCustomThemes", deleteAllCustomThemes);
