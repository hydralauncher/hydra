import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const openMainWindow = async () => {
  return WindowManager.openMainWindow();
};

registerEvent("openMainWindow", openMainWindow);
