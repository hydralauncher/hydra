import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const closeGameLauncherWindow = async () => {
  WindowManager.closeGameLauncherWindow();
};

registerEvent("closeGameLauncherWindow", closeGameLauncherWindow);
