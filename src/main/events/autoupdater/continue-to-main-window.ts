import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const continueToMainWindow = async (_event: Electron.IpcMainInvokeEvent) => {
  WindowManager.splashWindow?.close();
  WindowManager.createMainWindow();
};

registerEvent("continueToMainWindow", continueToMainWindow);
