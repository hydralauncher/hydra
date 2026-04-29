import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const isMainWindowOpen = async () => {
  return WindowManager.isAppWindowVisible();
};

registerEvent("isMainWindowOpen", isMainWindowOpen);
