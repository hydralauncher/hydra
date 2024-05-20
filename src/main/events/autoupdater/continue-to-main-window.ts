import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";
import { autoUpdater } from "electron-updater";

const continueToMainWindow = async (_event: Electron.IpcMainInvokeEvent) => {
  autoUpdater.removeAllListeners();
  WindowManager.splashWindow?.close();
  WindowManager.createMainWindow();
};

registerEvent("continueToMainWindow", continueToMainWindow);
