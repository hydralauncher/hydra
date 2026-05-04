import { appVersion, defaultDownloadsPath, isStaging } from "@main/constants";
import { ipcMain } from "electron";

import "./auth";
import "./autoupdater";
import "./catalogue";
import "./cloud-save";
import "./google-drive";
import "./local-backup";
import "./download-sources";
import "./hardware";
import "./library";
import "./leveldb";
import "./misc";
import "./notifications";
import "./profile";
import "./themes";
import "./torrenting";
import "./user";
import "./user-preferences";
import "./roms";
import "./news";

import { isPortableVersion } from "@main/helpers";
import { WindowManager } from "@main/services";

ipcMain.handle("ping", () => "pong");
ipcMain.handle("getVersion", () => appVersion);
ipcMain.handle("isStaging", () => isStaging);
ipcMain.handle("isPortableVersion", () => isPortableVersion());
ipcMain.handle("getDefaultDownloadsPath", () => defaultDownloadsPath);
ipcMain.handle("openDevTools", () => {
  WindowManager.mainWindow?.webContents.openDevTools();
});
