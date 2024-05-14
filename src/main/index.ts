import { app, BrowserWindow, net, protocol } from "electron";
import updater from "electron-updater";
import i18n from "i18next";
import path from "node:path";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { resolveDatabaseUpdates, WindowManager } from "@main/services";
import { dataSource } from "@main/data-source";
import * as resources from "@locales";
import { userPreferencesRepository } from "@main/repository";

const { autoUpdater } = updater;

autoUpdater.setFeedURL({
  provider: "github",
  owner: "hydralauncher",
  repo: "hydra",
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

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
app.whenReady().then(() => {
  electronApp.setAppUserModelId("site.hydralauncher.hydra");

  protocol.handle("hydra", (request) =>
    net.fetch("file://" + request.url.slice("hydra://".length))
  );

  dataSource.initialize().then(async () => {
    await resolveDatabaseUpdates();

    await import("./main");

    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });

    WindowManager.createMainWindow();
    WindowManager.createSystemTray(userPreferences?.language || "en");

    WindowManager.mainWindow?.on("ready-to-show", () => {
      autoUpdater.checkForUpdatesAndNotify();
    });
  });
});

app.on("browser-window-created", (_, window) => {
  optimizer.watchWindowShortcuts(window);
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

  const [, path] = commandLine.pop()?.split("://") ?? [];
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
