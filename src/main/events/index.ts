import { defaultDownloadsPath } from "@main/constants";
import { app, ipcMain } from "electron";

import "./autoupdater/check-for-updates";
import "./autoupdater/continue-to-main-window";
import "./autoupdater/restart-and-install-update";
import "./catalogue/get-catalogue";
import "./catalogue/get-game-shop-details";
import "./catalogue/get-games";
import "./catalogue/get-how-long-to-beat";
import "./catalogue/get-random-game";
import "./catalogue/search-game-repacks";
import "./catalogue/search-games";
import "./hardware/get-disk-free-space";
import "./library/add-game-to-library";
import "./library/change-executable-path";
import "./library/close-game";
import "./library/delete-game-folder";
import "./library/get-game-by-object-id";
import "./library/get-library";
import "./library/open-game";
import "./library/open-game-folder";
import "./library/open-game-installer";
import "./library/remove-game";
import "./library/remove-game-from-library";
import "./misc/open-external";
import "./misc/show-open-dialog";
import "./torrenting/cancel-game-download";
import "./torrenting/pause-game-download";
import "./torrenting/resume-game-download";
import "./torrenting/start-game-download";

import "./user-preferences/auto-launch";
import "./user-preferences/get-user-preferences";
import "./user-preferences/update-user-preferences";

ipcMain.handle("ping", () => "pong");
ipcMain.handle("getVersion", () => app.getVersion());
ipcMain.handle("getDefaultDownloadsPath", () => defaultDownloadsPath);
