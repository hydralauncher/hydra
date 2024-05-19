import { AppUpdaterEvents } from "@types";
import { registerEvent } from "../register-event";
import updater, { ProgressInfo, UpdateInfo } from "electron-updater";
import { WindowManager } from "@main/services";
import { app } from "electron";

const { autoUpdater } = updater;

const checkForUpdates = async (_event: Electron.IpcMainInvokeEvent) => {
  const sendEvent = (event: AppUpdaterEvents) => {
    WindowManager.splashWindow?.webContents.send("autoUpdaterEvent", event);
  };

  autoUpdater
    .once("error", () => {
      sendEvent({ type: "error" });
    })
    .once("checking-for-update", () => {
      sendEvent({ type: "checking-for-updates" });
    })
    .once("update-not-available", (info: UpdateInfo) => {
      sendEvent({ type: "update-not-available", info });
    })
    .once("update-available", (info: UpdateInfo) => {
      sendEvent({ type: "update-available", info });
    })
    .once("update-downloaded", () => {
      sendEvent({ type: "update-downloaded" });
    })
    .addListener("download-progress", (info: ProgressInfo) => {
      sendEvent({ type: "download-progress", info });
    })
    .once("update-cancelled", (info: UpdateInfo) => {
      sendEvent({ type: "update-cancelled", info });
    });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  } else {
    // electron updater does not check for updates in dev build, so mocking here to test the ui
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    sendEvent({ type: "checking-for-updates" });

    await sleep(1500);
    sendEvent({
      type: "update-available",
      info: {
        version: "1.2.2",
        files: [],
        releaseDate: "19/05/2024",
        path: "",
        sha512: "",
      },
    });

    await sleep(500);

    const total = 123456;
    for (let i = 0; i <= 5; i++) {
      sendEvent({
        type: "download-progress",
        info: {
          total: total,
          delta: 123,
          transferred: (total * i) / 5,
          percent: (total * i) / 5 / total,
          bytesPerSecond: 4568,
        },
      });
      await sleep(500);
    }

    sendEvent({ type: "update-downloaded" });
  }
};

registerEvent("checkForUpdates", checkForUpdates);
