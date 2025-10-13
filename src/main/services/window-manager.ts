import {
  BrowserWindow,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  Tray,
  app,
  nativeImage,
  screen,
  shell,
} from "electron";
import { is } from "@electron-toolkit/utils";
import { t } from "i18next";
import path from "node:path";
import icon from "@resources/icon.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import { HydraApi } from "./hydra-api";
import UserAgent from "user-agents";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { orderBy, slice } from "lodash-es";
import type {
  AchievementCustomNotificationPosition,
  ScreenState,
  UserPreferences,
} from "@types";
import { AuthPage, generateAchievementCustomNotificationTest } from "@shared";
import { isStaging } from "@main/constants";

export class WindowManager {
  public static mainWindow: Electron.BrowserWindow | null = null;
  public static notificationWindow: Electron.BrowserWindow | null = null;

  private static readonly editorWindows: Map<string, BrowserWindow> = new Map();

  private static initialConfigInitializationMainWindow: Electron.BrowserWindowConstructorOptions =
    {
      width: 1200,
      height: 720,
      minWidth: 1024,
      minHeight: 540,
      backgroundColor: "#1c1c1c",
      titleBarStyle: process.platform === "linux" ? "default" : "hidden",
      icon,
      trafficLightPosition: { x: 16, y: 16 },
      titleBarOverlay: {
        symbolColor: "#DADBE1",
        color: "#00000000",
        height: 34,
      },
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
    };

  private static async loadWindowURL(window: BrowserWindow, hash: string = "") {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#/${hash}`);
    } else if (import.meta.env.MAIN_VITE_RENDERER_URL) {
      // Try to load from remote URL in production
      try {
        await window.loadURL(
          `${import.meta.env.MAIN_VITE_RENDERER_URL}#/${hash}`
        );
      } catch (error) {
        // Fall back to local file if remote URL fails
        console.error(
          "Failed to load from MAIN_VITE_RENDERER_URL, falling back to local file:",
          error
        );
        window.loadFile(path.join(__dirname, "../renderer/index.html"), {
          hash,
        });
      }
    } else {
      window.loadFile(path.join(__dirname, "../renderer/index.html"), {
        hash,
      });
    }
  }

  private static async loadMainWindowURL(hash: string = "") {
    if (this.mainWindow) {
      await this.loadWindowURL(this.mainWindow, hash);
    }
  }

  private static async saveScreenConfig(configScreenWhenClosed: ScreenState) {
    await db.put(levelKeys.screenState, configScreenWhenClosed, {
      valueEncoding: "json",
    });
  }

  private static async loadScreenConfig() {
    const data = await db.get<string, ScreenState | undefined>(
      levelKeys.screenState,
      {
        valueEncoding: "json",
      }
    );
    return data ?? { isMaximized: false, height: 720, width: 1200 };
  }

  private static updateInitialConfig(
    newConfig: Partial<Electron.BrowserWindowConstructorOptions>
  ) {
    this.initialConfigInitializationMainWindow = {
      ...this.initialConfigInitializationMainWindow,
      ...newConfig,
    };
  }

  public static async createMainWindow() {
    if (this.mainWindow) return;

    const { isMaximized = false, ...configWithoutMaximized } =
      await this.loadScreenConfig();

    this.updateInitialConfig(configWithoutMaximized);

    this.mainWindow = new BrowserWindow(
      this.initialConfigInitializationMainWindow
    );

    if (isMaximized) {
      this.mainWindow.maximize();
    }

    this.mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (
          details.webContentsId !== this.mainWindow?.webContents.id ||
          details.url.includes("chatwoot")
        ) {
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
        if (
          details.webContentsId !== this.mainWindow?.webContents.id ||
          details.url.includes("featurebase") ||
          details.url.includes("chatwoot")
        ) {
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
      if (!app.isPackaged || isStaging)
        WindowManager.mainWindow?.webContents.openDevTools();
      WindowManager.mainWindow?.show();
    });

    this.mainWindow.on("close", async () => {
      const mainWindow = this.mainWindow;
      this.mainWindow = null;

      const userPreferences = await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      if (mainWindow) {
        mainWindow.setProgressBar(-1);

        const lastBounds = mainWindow.getBounds();
        const isMaximized = mainWindow.isMaximized() ?? false;
        const screenConfig = isMaximized
          ? {
              x: undefined,
              y: undefined,
              height: this.initialConfigInitializationMainWindow.height ?? 720,
              width: this.initialConfigInitializationMainWindow.width ?? 1200,
              isMaximized: true,
            }
          : { ...lastBounds, isMaximized };

        await this.saveScreenConfig(screenConfig);
      }

      if (userPreferences?.preferQuitInsteadOfHiding) {
        app.quit();
      }
    });

    this.mainWindow.webContents.setWindowOpenHandler((handler) => {
      shell.openExternal(handler.url);
      return { action: "deny" };
    });
  }

  public static openAuthWindow(page: AuthPage, searchParams: URLSearchParams) {
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

      authWindow.loadURL(
        `${import.meta.env.MAIN_VITE_AUTH_URL}${page}?${searchParams.toString()}`
      );

      authWindow.once("ready-to-show", () => {
        authWindow.show();
      });

      authWindow.webContents.on("will-navigate", (_event, url) => {
        if (url.startsWith("hydralauncher://auth")) {
          authWindow.close();

          HydraApi.handleExternalAuth(url);
          return;
        }

        if (url.startsWith("hydralauncher://update-account")) {
          authWindow.close();

          WindowManager.mainWindow?.webContents.send("on-account-updated");
        }
      });
    }
  }

  private static loadNotificationWindowURL() {
    if (this.notificationWindow) {
      this.loadWindowURL(this.notificationWindow, "achievement-notification");
    }
  }

  private static readonly NOTIFICATION_WINDOW_WIDTH = 360;
  private static readonly NOTIFICATION_WINDOW_HEIGHT = 140;

  private static async getNotificationWindowPosition(
    position: AchievementCustomNotificationPosition | undefined
  ) {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;

    if (position === "bottom-left") {
      return {
        x: 0,
        y: height - this.NOTIFICATION_WINDOW_HEIGHT,
      };
    }

    if (position === "bottom-center") {
      return {
        x: (width - this.NOTIFICATION_WINDOW_WIDTH) / 2,
        y: height - this.NOTIFICATION_WINDOW_HEIGHT,
      };
    }

    if (position === "bottom-right") {
      return {
        x: width - this.NOTIFICATION_WINDOW_WIDTH,
        y: height - this.NOTIFICATION_WINDOW_HEIGHT,
      };
    }

    if (position === "top-center") {
      return {
        x: (width - this.NOTIFICATION_WINDOW_WIDTH) / 2,
        y: 0,
      };
    }

    if (position === "top-right") {
      return {
        x: width - this.NOTIFICATION_WINDOW_WIDTH,
        y: 0,
      };
    }

    return {
      x: 0,
      y: 0,
    };
  }

  public static async createNotificationWindow() {
    if (this.notificationWindow) return;

    const userPreferences = await db.get<string, UserPreferences | undefined>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );

    if (
      userPreferences?.achievementNotificationsEnabled === false ||
      userPreferences?.achievementCustomNotificationsEnabled === false
    ) {
      return;
    }

    const { x, y } = await this.getNotificationWindowPosition(
      userPreferences?.achievementCustomNotificationPosition
    );

    this.notificationWindow = new BrowserWindow({
      transparent: true,
      maximizable: false,
      autoHideMenuBar: true,
      minimizable: false,
      backgroundColor: "#00000000",
      focusable: false,
      skipTaskbar: true,
      frame: false,
      width: this.NOTIFICATION_WINDOW_WIDTH,
      height: this.NOTIFICATION_WINDOW_HEIGHT,
      x,
      y,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });
    this.notificationWindow.setIgnoreMouseEvents(true);

    this.notificationWindow.setAlwaysOnTop(true, "screen-saver", 1);
    this.loadNotificationWindowURL();

    if (!app.isPackaged || isStaging) {
      this.notificationWindow.webContents.openDevTools();
    }
  }

  public static async showAchievementTestNotification() {
    const userPreferences = await db.get<string, UserPreferences>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );

    const language = userPreferences.language ?? "en";

    this.notificationWindow?.webContents.send(
      "on-achievement-unlocked",
      userPreferences.achievementCustomNotificationPosition ?? "top-left",
      [
        generateAchievementCustomNotificationTest(t, language),
        generateAchievementCustomNotificationTest(t, language, {
          isRare: true,
          isHidden: true,
        }),
        generateAchievementCustomNotificationTest(t, language, {
          isPlatinum: true,
        }),
      ]
    );
  }

  public static async closeNotificationWindow() {
    if (this.notificationWindow) {
      this.notificationWindow.close();
      this.notificationWindow = null;
    }
  }

  public static openEditorWindow(themeId: string) {
    if (this.mainWindow) {
      const existingWindow = this.editorWindows.get(themeId);
      if (existingWindow) {
        if (existingWindow.isMinimized()) {
          existingWindow.restore();
        }
        existingWindow.focus();
        return;
      }

      const editorWindow = new BrowserWindow({
        width: 720,
        height: 720,
        minWidth: 600,
        minHeight: 540,
        backgroundColor: "#1c1c1c",
        titleBarStyle: process.platform === "linux" ? "default" : "hidden",
        icon,
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

      this.editorWindows.set(themeId, editorWindow);

      editorWindow.removeMenu();

      this.loadWindowURL(editorWindow, `theme-editor?themeId=${themeId}`);

      editorWindow.once("ready-to-show", () => {
        editorWindow.show();
        if (!app.isPackaged || isStaging) {
          editorWindow.webContents.openDevTools();
        }
      });

      editorWindow.webContents.on("before-input-event", (_event, input) => {
        if (input.key === "F12") {
          editorWindow.webContents.toggleDevTools();
        }
      });

      editorWindow.on("close", () => {
        this.editorWindows.delete(themeId);
      });
    }
  }

  public static closeEditorWindow(themeId?: string) {
    if (themeId) {
      const editorWindow = this.editorWindows.get(themeId);
      if (editorWindow) {
        editorWindow.close();
      }
    } else {
      this.editorWindows.forEach((editorWindow) => {
        editorWindow.close();
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
      const games = await gamesSublevel
        .values()
        .all()
        .then((games) => {
          const filteredGames = games.filter(
            (game) =>
              !game.isDeleted && game.executablePath && game.lastTimePlayed
          );

          const sortedGames = orderBy(filteredGames, "lastTimePlayed", "desc");

          return slice(sortedGames, 0, 6);
        });

      const recentlyPlayedGames: Array<MenuItemConstructorOptions | MenuItem> =
        games.map(({ title, executablePath }) => ({
          label: title.length > 18 ? `${title.slice(0, 18)}…` : title,
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

      if (process.platform === "linux") {
        tray.setContextMenu(contextMenu);
      }

      return contextMenu;
    };

    const showContextMenu = async () => {
      const contextMenu = await updateSystemTray();
      tray.popUpContextMenu(contextMenu);
    };

    tray.setToolTip("Hydra Launcher");

    if (process.platform === "win32") {
      await updateSystemTray();

      tray.addListener("double-click", () => {
        if (this.mainWindow) {
          this.mainWindow.show();
        } else {
          this.createMainWindow();
        }
      });

      tray.addListener("right-click", showContextMenu);
    } else if (process.platform === "linux") {
      await updateSystemTray();

      tray.addListener("click", () => {
        if (this.mainWindow) {
          this.mainWindow.show();
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
