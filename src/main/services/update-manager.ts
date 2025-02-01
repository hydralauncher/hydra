import updater, { UpdateInfo } from "electron-updater";
import { logger, WindowManager } from "@main/services";
import { AppUpdaterEvent } from "@types";
import { app } from "electron";
import { publishNotificationUpdateReadyToInstall } from "@main/services/notifications";

const isAutoInstallAvailable =
  process.platform !== "darwin" && process.env.PORTABLE_EXECUTABLE_FILE == null;

const { autoUpdater } = updater;
const sendEventsForDebug = false;

export class UpdateManager {
  private static hasNotified = false;
  private static newVersion = "";
  private static checkTick = 0;

  private static mockValuesForDebug() {
    this.sendEvent({ type: "update-available", info: { version: "1.3.0" } });
    this.sendEvent({ type: "update-downloaded" });
  }

  private static sendEvent(event: AppUpdaterEvent) {
    WindowManager.mainWindow?.webContents.send("autoUpdaterEvent", event);
  }

  public static checkForUpdates() {
    autoUpdater
      .once("update-available", (info: UpdateInfo) => {
        this.sendEvent({ type: "update-available", info });
        this.newVersion = info.version;
      })
      .once("update-downloaded", () => {
        this.sendEvent({ type: "update-downloaded" });

        if (!this.hasNotified) {
          this.hasNotified = true;
          publishNotificationUpdateReadyToInstall(this.newVersion);
        }
      });

    if (app.isPackaged) {
      autoUpdater.autoDownload = isAutoInstallAvailable;
      autoUpdater.checkForUpdates().then((result) => {
        logger.log(`Check for updates result: ${result}`);
      });
    } else if (sendEventsForDebug) {
      this.mockValuesForDebug();
    }

    return isAutoInstallAvailable;
  }

  public static checkForUpdatePeriodically() {
    if (this.checkTick % 2000 == 0) {
      this.checkForUpdates();
    }
    this.checkTick++;
  }
}
