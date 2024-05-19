import { AppUpdaterEvents } from "@types";
import { registerEvent } from "../register-event";
import updater, {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater";

const { autoUpdater } = updater;

const checkForUpdates = async (
  _event: Electron.IpcMainInvokeEvent,
  cb: (value: AppUpdaterEvents) => void
) => {
  console.log("check for updates event");
  autoUpdater
    .addListener("error", (error: Error, message?: string) => {
      cb({ error, message });
    })
    .addListener("checking-for-update", () => {
      cb("checking-for-updates");
    })
    .addListener("update-not-available", (info: UpdateInfo) => {
      cb(info);
    })
    .addListener("update-available", (info: UpdateInfo) => {
      cb(info);
    })
    .addListener("update-downloaded", (event: UpdateDownloadedEvent) => {
      cb(event);
    })
    .addListener("download-progress", (info: ProgressInfo) => {
      cb(info);
    })
    .addListener("update-cancelled", (info: UpdateInfo) => {
      cb(info);
    });

  autoUpdater.checkForUpdates();
};

registerEvent("checkForUpdates", checkForUpdates);
