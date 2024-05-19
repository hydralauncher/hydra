import { app } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";
import { WindowManager } from "@main/services";

const { autoUpdater } = updater;

const restartAndInstallUpdate = async (_event: Electron.IpcMainInvokeEvent) => {
  if (app.isPackaged) {
    autoUpdater.quitAndInstall(true, true);
  } else {
    WindowManager.splashWindow?.close();
    WindowManager.createMainWindow();
  }
};

registerEvent("restartAndInstallUpdate", restartAndInstallUpdate);
