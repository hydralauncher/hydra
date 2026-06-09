import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const isMainWindowOpen = async () => {
  return (
    WindowManager.mainWindow !== null &&
    !WindowManager.mainWindow.isDestroyed() &&
    WindowManager.mainWindow.isVisible()
  );
};

registerEvent("isMainWindowOpen", isMainWindowOpen);
