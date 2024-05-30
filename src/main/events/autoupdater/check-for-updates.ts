import { AppUpdaterEvents } from "@types";
import { registerEvent } from "../register-event";
import updater, { UpdateInfo } from "electron-updater";
import { WindowManager } from "@main/services";
import { app } from "electron";

const { autoUpdater } = updater;

const sendEvent = (event: AppUpdaterEvents) => {
  WindowManager.mainWindow?.webContents.send("autoUpdaterEvent", event);
};

const mockValuesForDebug = () => {
  sendEvent({ type: "update-available", info: { version: "1.3.0" } });
};

const checkForUpdates = async (_event: Electron.IpcMainInvokeEvent) => {
  autoUpdater
    .once("update-available", (info: UpdateInfo) => {
      sendEvent({ type: "update-available", info });
    })
    .once("update-downloaded", () => {
      sendEvent({ type: "update-downloaded" });
    });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  } else {
    mockValuesForDebug();
  }
};

registerEvent("checkForUpdates", checkForUpdates);
