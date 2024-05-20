import { AppUpdaterEvents } from "@types";
import { registerEvent } from "../register-event";
import updater, { ProgressInfo, UpdateInfo } from "electron-updater";
import { WindowManager } from "@main/services";
import { app } from "electron";

const { autoUpdater } = updater;

const sendEvent = (event: AppUpdaterEvents) => {
  WindowManager.splashWindow?.webContents.send("autoUpdaterEvent", event);
};

const mockValuesForDebug = async () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  sendEvent({ type: "checking-for-updates" });

  await sleep(1500);
  sendEvent({
    type: "update-available",
    info: {
      version: "1.2.3",
      files: [],
      releaseDate: "19/05/2024",
      path: "",
      sha512: "",
    },
  });

  await sleep(1000);

  const total = 123456;
  for (let i = 0; i <= 5; i++) {
    sendEvent({
      type: "download-progress",
      info: {
        total: total,
        delta: 123,
        transferred: (total * i) / 5,
        percent: ((total * i) / 5 / total) * 100,
        bytesPerSecond: 4568,
      },
    });
    await sleep(1000);
  }

  sendEvent({ type: "update-downloaded" });
};

const checkForUpdates = async (_event: Electron.IpcMainInvokeEvent) => {
  autoUpdater
    .addListener("error", () => {
      sendEvent({ type: "error" });
    })
    .addListener("checking-for-update", () => {
      sendEvent({ type: "checking-for-updates" });
    })
    .addListener("update-not-available", (info: UpdateInfo) => {
      sendEvent({ type: "update-not-available", info });
    })
    .addListener("update-available", (info: UpdateInfo) => {
      sendEvent({ type: "update-available", info });
    })
    .addListener("update-downloaded", () => {
      sendEvent({ type: "update-downloaded" });
    })
    .addListener("download-progress", (info: ProgressInfo) => {
      sendEvent({ type: "download-progress", info });
    })
    .addListener("update-cancelled", (info: UpdateInfo) => {
      sendEvent({ type: "update-cancelled", info });
    });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  } else {
    await mockValuesForDebug();
  }
};

registerEvent("checkForUpdates", checkForUpdates);
