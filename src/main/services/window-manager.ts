import {
  BrowserWindow,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  Tray,
  app,
  shell,
} from "electron";
import { is } from "@electron-toolkit/utils";
import { t } from "i18next";
import path from "node:path";
import icon from "@resources/icon.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import { gameRepository, userPreferencesRepository } from "@main/repository";
import { IsNull, Not } from "typeorm";

export class WindowManager {
  public static mainWindow: Electron.BrowserWindow | null = null;
  public static splashWindow: Electron.BrowserWindow | null = null;
  public static isReadyToShowMainWindow = false;
  private static isMainMaximized = false;

  private static loadURL(hash = "") {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      this.mainWindow?.loadURL(
        `${process.env["ELECTRON_RENDERER_URL"]}#/${hash}`
      );
    } else {
      this.mainWindow?.loadFile(
        path.join(__dirname, "../renderer/index.html"),
        {
          hash,
        }
      );
    }
  }

  private static loadSplashURL() {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      this.splashWindow?.loadURL(
        `${process.env["ELECTRON_RENDERER_URL"]}#/splash`
      );
    } else {
      this.splashWindow?.loadFile(
        path.join(__dirname, "../renderer/index.html"),
        {
          hash: "splash",
        }
      );
    }
  }

  public static createSplashScreen() {
    if (this.splashWindow) return;

    this.splashWindow = new BrowserWindow({
      width: 380,
      height: 380,
      frame: false,
      resizable: false,
      backgroundColor: "#1c1c1c",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    this.loadSplashURL();
    this.splashWindow.removeMenu();
    if (this.splashWindow?.isMaximized()) {
      this.splashWindow?.unmaximize(); 
      this.isMainMaximized = true;
    }
  }

  public static createMainWindow() {
    if (this.mainWindow || !this.isReadyToShowMainWindow) return;

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 720,
      minWidth: 1024,
      minHeight: 540,
      backgroundColor: "#1c1c1c",
      titleBarStyle: "hidden",
      ...(process.platform === "linux" ? { icon } : {}),
      trafficLightPosition: { x: 16, y: 16 },
      titleBarOverlay: {
        symbolColor: "#DADBE1",
        color: "#151515",
        height: 34,
      },
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
    });

    this.loadURL();
    this.mainWindow.removeMenu();
    if (this.isMainMaximized) this.mainWindow?.maximize();

    this.mainWindow.on("ready-to-show", () => {
      if (!app.isPackaged) WindowManager.mainWindow?.webContents.openDevTools();
      WindowManager.mainWindow?.show();
    });

    this.mainWindow.on("close", async () => {
      const userPreferences = await userPreferencesRepository.findOne({
        where: { id: 1 },
      });

      if (userPreferences?.preferQuitInsteadOfHiding) {
        app.quit();
      }
      WindowManager.mainWindow?.setProgressBar(-1);
    });
  }

  public static prepareMainWindowAndCloseSplash() {
    this.isReadyToShowMainWindow = true;
    this.splashWindow?.close();
    this.createMainWindow();
    if (this.isMainMaximized) this.mainWindow?.maximize();
  }

  public static redirect(hash: string) {
    if (!this.mainWindow) this.createMainWindow();
    this.loadURL(hash);

    if (this.mainWindow?.isMinimized()) this.mainWindow.restore();
    this.mainWindow?.focus();
  }

  public static createSystemTray(language: string) {
    const tray = new Tray(trayIcon);

    const updateSystemTray = async () => {
      const games = await gameRepository.find({
        where: {
          isDeleted: false,
          executablePath: Not(IsNull()),
          lastTimePlayed: Not(IsNull()),
        },
        take: 5,
        order: {
          updatedAt: "DESC",
        },
      });

      const recentlyPlayedGames: Array<MenuItemConstructorOptions | MenuItem> =
        games.map(({ title, executablePath }) => ({
          label: title,
          type: "normal",
          click: async () => {
            if (!executablePath) return;

            shell.openPath(executablePath);
          },
        }));

      const contextMenu = Menu.buildFromTemplate([
        {
          label: t("open", {
            ns: "system_tray",
            lng: language,
          }),
          type: "normal",
          click: () => {
            if (this.mainWindow) {
              this.mainWindow.show();
            } else {
              this.createMainWindow();
            }
          },
        },
        {
          type: "separator",
        },
        ...recentlyPlayedGames,
        {
          type: "separator",
        },
        {
          label: t("quit", {
            ns: "system_tray",
            lng: language,
          }),
          type: "normal",
          click: () => app.quit(),
        },
      ]);

      return contextMenu;
    };

    tray.setToolTip("Hydra");

    if (process.platform === "win32" || process.platform === "linux") {
      tray.addListener("click", () => {
        if (this.mainWindow) {
          if (WindowManager.mainWindow?.isMinimized())
            WindowManager.mainWindow.restore();

          WindowManager.mainWindow?.focus();
          return;
        }

        this.createMainWindow();
      });

      tray.addListener("right-click", async () => {
        const contextMenu = await updateSystemTray();
        tray.popUpContextMenu(contextMenu);
      });
    }
  }
}
