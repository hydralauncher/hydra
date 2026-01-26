import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const showGameLauncherWindow = async () => {
  WindowManager.showGameLauncherWindow();
};

registerEvent("showGameLauncherWindow", showGameLauncherWindow);
