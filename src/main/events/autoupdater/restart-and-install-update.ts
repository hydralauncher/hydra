import { app } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";

const { autoUpdater } = updater;

export const restartAndInstallUpdate = () => {
  autoUpdater.removeAllListeners();
  if (app.isPackaged) {
    autoUpdater.quitAndInstall(false);
  }
};

const restartAndInstallUpdateEvent = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  restartAndInstallUpdate();
};

registerEvent("restartAndInstallUpdate", restartAndInstallUpdateEvent);
