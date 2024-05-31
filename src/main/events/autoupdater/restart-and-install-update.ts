import { app } from "electron";
import { registerEvent } from "../register-event";
import updater from "electron-updater";
import { releasesPageUrl } from "@main/constants";

const { autoUpdater } = updater;

const restartAndInstallUpdate = async (_event: Electron.IpcMainInvokeEvent) => {
  autoUpdater.removeAllListeners();
  if (app.isPackaged) {
    if (process.platform === "darwin") {
      open(`${releasesPageUrl}`);
    } else {
      autoUpdater.quitAndInstall(true, true);
    }
  }
};

registerEvent("restartAndInstallUpdate", restartAndInstallUpdate);
