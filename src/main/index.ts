import { app, BrowserWindow, net, protocol } from "electron";
import updater from "electron-updater";
import i18n from "i18next";
import path from "node:path";
import url from "node:url";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { logger, WindowManager } from "@main/services";
import resources from "@locales";
import { PythonRPC } from "./services/python-rpc";
import { db, levelKeys } from "./level";
import { loadState } from "./main";

const { autoUpdater } = updater;

autoUpdater.setFeedURL({
  provider: "github",
  owner: "hydralauncher",
  repo: "hydra",
});

autoUpdater.logger = logger;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

if (process.platform !== "linux") {
  app.commandLine.appendSwitch("--no-sandbox");
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
app.whenReady().then(async () => {
  electronApp.setAppUserModelId("gg.hydralauncher.hydra");

  protocol.handle("local", (request) => {
    const filePath = request.url.slice("local:".length);
    return net.fetch(url.pathToFileURL(decodeURI(filePath)).toString());
  });

  await loadState();

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .catch(() => "en");

  if (language) i18n.changeLanguage(language);

  if (!process.argv.includes("--hidden")) {
    WindowManager.createMainWindow();
  }

  WindowManager.createNotificationWindow();
  WindowManager.createSystemTray(language || "en");
});

app.on("browser-window-created", (_, window) => {
  optimizer.watchWindowShortcuts(window);
});

const handleDeepLinkPath = (uri?: string) => {
  if (!uri) return;

  try {
    const url = new URL(uri);

    if (url.host === "install-source") {
      WindowManager.redirect(`settings${url.search}`);
      return;
    }

    if (url.host === "profile") {
      const userId = url.searchParams.get("userId");

      if (userId) {
        WindowManager.redirect(`profile/${userId}`);
      }

      return;
    }

    if (url.host === "install-theme") {
      const themeName = url.searchParams.get("theme");
      const authorId = url.searchParams.get("authorId");
      const authorName = url.searchParams.get("authorName");

      if (themeName && authorId && authorName) {
        WindowManager.redirect(
          `settings?theme=${themeName}&authorId=${authorId}&authorName=${authorName}`
        );
      }
    }
  } catch (error) {
    logger.error("Error handling deep link", uri, error);
  }
};

app.on("second-instance", (_event, commandLine) => {
  // Someone tried to run a second instance, we should focus our window.
  if (WindowManager.mainWindow) {
    if (WindowManager.mainWindow.isMinimized())
      WindowManager.mainWindow.restore();

    WindowManager.mainWindow.focus();
  } else {
    WindowManager.createMainWindow();
  }

  handleDeepLinkPath(commandLine.pop());
});

app.on("open-url", (_event, url) => {
  handleDeepLinkPath(url);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  WindowManager.mainWindow = null;
});

app.on("before-quit", () => {
  /* Disconnects libtorrent */
  PythonRPC.kill();
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
