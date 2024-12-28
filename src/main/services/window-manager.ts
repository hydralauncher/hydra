import {
  BrowserWindow,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  Tray,
  app,
  nativeImage,
  shell,
} from "electron";
import { is } from "@electron-toolkit/utils";
import i18next, { t } from "i18next";
import path from "node:path";
import icon from "@resources/icon.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import { gameRepository, userPreferencesRepository } from "@main/repository";
import { IsNull, Not } from "typeorm";
import { HydraApi } from "./hydra-api";
import UserAgent from "user-agents";

export class WindowManager {
  public static mainWindow: Electron.BrowserWindow | null = null;

  private static loadMainWindowURL(hash = "") {
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

  public static createMainWindow() {
    if (this.mainWindow) return;

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 720,
      minWidth: 1024,
      minHeight: 540,
      backgroundColor: "#1c1c1c",
      titleBarStyle: process.platform === "linux" ? "default" : "hidden",
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

    this.mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (details.webContentsId !== this.mainWindow?.webContents.id) {
          return callback(details);
        }

        const userAgent = new UserAgent();

        callback({
          requestHeaders: {
            ...details.requestHeaders,
            "user-agent": userAgent.toString(),
          },
        });
      }
    );

    this.mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
        if (details.webContentsId !== this.mainWindow?.webContents.id) {
          return callback(details);
        }

        if (details.url.includes("featurebase")) {
          return callback(details);
        }

        if (details.url.includes("chatwoot")) {
          return callback(details);
        }

        const headers = {
          "access-control-allow-origin": ["*"],
          "access-control-allow-methods": ["GET, POST, PUT, DELETE, OPTIONS"],
          "access-control-expose-headers": ["ETag"],
          "access-control-allow-headers": [
            "Content-Type, Authorization, X-Requested-With, If-None-Match",
          ],
        };

        if (details.method === "OPTIONS") {
          return callback({
            cancel: false,
            responseHeaders: {
              ...details.responseHeaders,
              ...headers,
            },
            statusLine: "HTTP/1.1 200 OK",
          });
        }

        return callback({
          responseHeaders: {
            ...details.responseHeaders,
            ...headers,
          },
        });
      }
    );

    this.loadMainWindowURL();
    this.mainWindow.removeMenu();

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
      WindowManager.mainWindow = null;
    });
  }

  public static openAuthWindow() {
    if (this.mainWindow) {
      const authWindow = new BrowserWindow({
        width: 600,
        height: 640,
        backgroundColor: "#1c1c1c",
        parent: this.mainWindow,
        modal: true,
        show: false,
        maximizable: false,
        resizable: false,
        minimizable: false,
        webPreferences: {
          sandbox: false,
          nodeIntegrationInSubFrames: true,
        },
      });

      authWindow.removeMenu();

      if (!app.isPackaged) authWindow.webContents.openDevTools();

      const searchParams = new URLSearchParams({
        lng: i18next.language,
      });

      authWindow.loadURL(
        `${import.meta.env.MAIN_VITE_AUTH_URL}/?${searchParams.toString()}`
      );

      authWindow.once("ready-to-show", () => {
        authWindow.show();
      });

      authWindow.webContents.on("will-navigate", (_event, url) => {
        if (url.startsWith("hydralauncher://auth")) {
          authWindow.close();

          HydraApi.handleExternalAuth(url);
        }
      });
    }
  }

  public static redirect(hash: string) {
    if (!this.mainWindow) this.createMainWindow();
    this.loadMainWindowURL(hash);

    if (this.mainWindow?.isMinimized()) this.mainWindow.restore();
    this.mainWindow?.focus();
  }

  public static async createSystemTray(language: string) {
    let tray: Tray;

    if (process.platform === "darwin") {
      const macIcon = nativeImage
        .createFromPath(trayIcon)
        .resize({ width: 24, height: 24 });
      tray = new Tray(macIcon);
    } else {
      tray = new Tray(trayIcon);
    }

    const updateSystemTray = async () => {
      const games = await gameRepository.find({
        where: {
          isDeleted: false,
          executablePath: Not(IsNull()),
          lastTimePlayed: Not(IsNull()),
        },
        take: 5,
        order: {
          lastTimePlayed: "DESC",
        },
      });

      const recentlyPlayedGames: Array<MenuItemConstructorOptions | MenuItem> =
        games.map(({ title, executablePath }) => ({
          label: title.length > 15 ? `${title.slice(0, 15)}…` : title,
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

      tray.setContextMenu(contextMenu);
      return contextMenu;
    };

    const showContextMenu = async () => {
      const contextMenu = await updateSystemTray();
      tray.popUpContextMenu(contextMenu);
    };

    tray.setToolTip("Hydra");

    if (process.platform !== "darwin") {
      await updateSystemTray();

      tray.addListener("click", () => {
        if (this.mainWindow) {
          if (
            WindowManager.mainWindow?.isMinimized() ||
            !WindowManager.mainWindow?.isVisible()
          ) {
            WindowManager.mainWindow?.show();
          }
        } else {
          this.createMainWindow();
        }
      });

      tray.addListener("right-click", showContextMenu);
    } else {
      tray.addListener("click", showContextMenu);
      tray.addListener("right-click", showContextMenu);
    }
  }
}
