import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const openMainWindow = async () => {
  WindowManager.openMainWindow();
};

registerEvent("openMainWindow", openMainWindow);
