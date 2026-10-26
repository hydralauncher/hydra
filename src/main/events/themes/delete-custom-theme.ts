import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";

const deleteCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
) => {
  await themesSublevel.del(themeId);

  WindowManager.sendToAppWindows("on-custom-theme-updated");
  achievementNotificationPresenter.notifyThemeUpdated();
};

registerEvent("deleteCustomTheme", deleteCustomTheme);
