import { app } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";

const { autoUpdater } = updater;

const restartAndInstallUpdate = async (_event: Electron.IpcMainInvokeEvent) => {
  autoUpdater.removeAllListeners();
  if (app.isPackaged) {
    autoUpdater.quitAndInstall(true, true);
  }
};

registerEvent("restartAndInstallUpdate", restartAndInstallUpdate);
