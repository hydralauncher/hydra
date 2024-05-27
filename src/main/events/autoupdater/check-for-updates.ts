import { AppUpdaterEvents } from "@types";
import { registerEvent } from "../register-event";
import updater, { UpdateInfo } from "electron-updater";
import { WindowManager } from "@main/services";
import { app } from "electron";

const { autoUpdater } = updater;

const sendEvent = (event: AppUpdaterEvents) => {
  WindowManager.mainWindow?.webContents.send("autoUpdaterEvent", event);
};

const mockValuesForDebug = async () => {
  sendEvent({ type: "update-available", info: { version: "1.3.0" } });
  // sendEvent({ type: "update-downloaded" });
};

const checkForUpdates = async (_event: Electron.IpcMainInvokeEvent) => {
  autoUpdater
    .addListener("update-available", (info: UpdateInfo) => {
      sendEvent({ type: "update-available", info });
    })
    .addListener("update-downloaded", () => {
      sendEvent({ type: "update-downloaded" });
    });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  } else {
    await mockValuesForDebug();
  }
};

registerEvent("checkForUpdates", checkForUpdates);
