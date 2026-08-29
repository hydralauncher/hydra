import { appVersion, defaultDownloadsPath, isStaging } from "@main/constants";
import { ipcMain } from "electron";
import { ScreenshotService } from "@main/services/screenshot";
import {
  cleanupAchievementSouvenirSync,
  getAchievementSouvenirSyncDetails,
  getAchievementSouvenirSyncStatus,
  retryAchievementSouvenirSync,
} from "@main/services/achievements/grouped-souvenir-worker";

import "./auth";
import "./autoupdater";
import "./big-picture";
import "./catalogue";
import "./cloud-save";
import "./connectivity";
import "./download-sources";
import "./friends";
import "./hardware";
import "./library";
import "./leveldb";
import "./main-window-controls";
import "./misc";
import "./notifications";
import "./profile";
import "./themes";
import "./torrenting";
import "./user";
import "./user-preferences";
import "./library/transfer-game-files";
import "./emulators";
import "./retroarch";

ipcMain.handle("ping", () => "pong");
ipcMain.handle("getVersion", () => appVersion);
ipcMain.handle("isStaging", () => isStaging);
ipcMain.handle("getDefaultDownloadsPath", () => defaultDownloadsPath);
ipcMain.handle("getScreenshotsPath", () =>
  ScreenshotService.getScreenshotsPath()
);
ipcMain.handle("getAchievementSouvenirSyncStatus", () =>
  getAchievementSouvenirSyncStatus()
);
ipcMain.handle("getAchievementSouvenirSyncDetails", () =>
  getAchievementSouvenirSyncDetails()
);
ipcMain.handle("retryAchievementSouvenirSync", () =>
  retryAchievementSouvenirSync()
);
ipcMain.handle("cleanupAchievementSouvenirSync", () =>
  cleanupAchievementSouvenirSync()
);
ipcMain.handle("getCloudIframeUrl", () =>
  new URL("/cloud", import.meta.env.MAIN_VITE_CHECKOUT_URL).toString()
);
