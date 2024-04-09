import { app, BrowserWindow } from "electron";
import i18n from "i18next";
import path from "node:path";
import {
  getSteamDBAlgoliaCredentials,
  logger,
  resolveDatabaseUpdates,
  WindowManager,
} from "@main/services";
import { updateElectronApp } from "update-electron-app";
import { dataSource } from "@main/data-source";
import * as resources from "@locales";
import { userPreferencesRepository } from "@main/repository";
import { stateManager } from "@main/state-manager";

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) app.quit();

if (process.platform !== "darwin") {
  updateElectronApp();
}

i18n.init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

const PROTOCOL = "hydralauncher";

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  dataSource.initialize().then(async () => {
    try {
      const algoliaCredentials = await getSteamDBAlgoliaCredentials();
      stateManager.setValue("steamDBAlgoliaCredentials", algoliaCredentials);
    } catch (err) {
      logger.error(err, { method: "getSteamDBAlgoliaCredentials" });
    }

    await resolveDatabaseUpdates();

    await import("./main");

    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });

    WindowManager.createMainWindow();
    WindowManager.createSystemTray(userPreferences?.language || "en");
  });
});

app.on("second-instance", (_event, commandLine) => {
  // Someone tried to run a second instance, we should focus our window.
  if (WindowManager.mainWindow) {
    if (WindowManager.mainWindow.isMinimized())
      WindowManager.mainWindow.restore();

    WindowManager.mainWindow.focus();
  } else {
    WindowManager.createMainWindow();
  }

  const [, path] = commandLine.pop().split("://");
  if (path) WindowManager.redirect(path);
});

app.on("open-url", (_event, url) => {
  const [, path] = url.split("://");
  WindowManager.redirect(path);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  WindowManager.mainWindow = null;
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    WindowManager.createMainWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
