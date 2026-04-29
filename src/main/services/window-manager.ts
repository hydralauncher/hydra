import { is } from "@electron-toolkit/utils";
import { isStaging } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import icon from "@resources/icon.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import { AuthPage, generateAchievementCustomNotificationTest } from "@shared";
import type {
  AchievementCustomNotificationPosition,
  ScreenState,
  UserPreferences,
} from "@types";
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
import { t } from "i18next";
import { orderBy, slice } from "lodash-es";
import path from "node:path";
import UserAgent from "user-agents";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";

type WindowMode = "main" | "big-picture";

export class WindowManager {
  public static mainWindow: Electron.BrowserWindow | null = null;
  public static notificationWindow: Electron.BrowserWindow | null = null;
  public static gameLauncherWindow: Electron.BrowserWindow | null = null;
  private static bigPicture: Electron.BrowserWindow | null = null;
  private static systemTray: Tray | null = null;
  private static systemTrayLanguage = "en";
  private static pendingModeSwitch: {
    sourceWindow: BrowserWindow | null;
    target: WindowMode;
  } | null = null;
  private static readonly modeSwitchClosingWindows = new WeakSet<BrowserWindow>();

  private static readonly editorWindows: Map<string, BrowserWindow> = new Map();

  private static initialConfigInitializationMainWindow: Electron.BrowserWindowConstructorOptions =
    {
      width: 1200,
      height: 860,
      minWidth: 1024,
      minHeight: 860,
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

  private static formatVersionNumber(version: string) {
    return version.replaceAll(".", "-");
  }

  private static async loadWindowURL(window: BrowserWindow, hash: string = "") {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#/${hash}`);
    } else if (import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN) {
      // Try to load from remote URL in production
      try {
        await window.loadURL(
          `https://release-v${this.formatVersionNumber(app.getVersion())}.${import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN}#/${hash}`
        );
      } catch (error) {
        // Fall back to local file if remote URL fails
        logger.error(
          "Failed to load from MAIN_VITE_LAUNCHER_SUBDOMAIN, falling back to local file:",
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

  private static async getUserPreferences() {
    return db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
  }

  private static getMainWindow() {
    if (this.mainWindow?.isDestroyed()) {
      this.mainWindow = null;
    }

    return this.mainWindow;
  }

  private static getBigPictureWindow() {
    if (this.bigPicture?.isDestroyed()) {
      this.bigPicture = null;
    }

    return this.bigPicture;
  }

  private static getVisibleWindowMode(): WindowMode | null {
    if (this.getBigPictureWindow()?.isVisible()) {
      return "big-picture";
    }

    if (this.getMainWindow()?.isVisible()) {
      return "main";
    }

    return null;
  }

  private static getOpenAppWindow() {
    const visibleMode = this.getVisibleWindowMode();

    if (visibleMode === "big-picture") {
      return this.getBigPictureWindow();
    }

    if (visibleMode === "main") {
      return this.getMainWindow();
    }

    return this.getBigPictureWindow() ?? this.getMainWindow();
  }

  private static async getCurrentOrPreferredMode() {
    const visibleMode = this.getVisibleWindowMode();

    if (visibleMode) {
      return visibleMode;
    }

    const userPreferences = await this.getUserPreferences();
    return userPreferences?.launchInBigPicture ? "big-picture" : "main";
  }

  private static focusWindow(window: BrowserWindow) {
    if (window.isDestroyed()) return;

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  }

  private static closeWindowForModeSwitch(window: BrowserWindow | null) {
    if (!window || window.isDestroyed()) return;

    this.modeSwitchClosingWindows.add(window);
    window.close();
  }

  private static completeModeSwitch(target: WindowMode) {
    if (this.pendingModeSwitch?.target !== target) return;

    const { sourceWindow } = this.pendingModeSwitch;
    this.pendingModeSwitch = null;

    this.closeWindowForModeSwitch(sourceWindow);
  }

  public static hasOpenAppWindow() {
    return this.getMainWindow() !== null || this.getBigPictureWindow() !== null;
  }

  public static isAppWindowVisible() {
    return this.getVisibleWindowMode() !== null;
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
    return data ?? { isMaximized: false, height: 860, width: 1200 };
  }

  private static updateInitialConfig(
    newConfig: Partial<Electron.BrowserWindowConstructorOptions>
  ) {
    this.initialConfigInitializationMainWindow = {
      ...this.initialConfigInitializationMainWindow,
      ...newConfig,
    };
  }

  public static async createMainWindow(hashOverride?: string) {
    if (this.mainWindow) return this.mainWindow;

    const userPreferences = await this.getUserPreferences();

    const { isMaximized = false, ...configWithoutMaximized } =
      await this.loadScreenConfig();

    this.updateInitialConfig(configWithoutMaximized);

    this.mainWindow = new BrowserWindow(
      this.initialConfigInitializationMainWindow
    );
    const mainWindow = this.mainWindow;

    if (isMaximized) {
      mainWindow.maximize();
    }

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (
          details.webContentsId !== mainWindow.webContents.id ||
          details.url.includes("chatwoot")
        ) {
          return callback(details);
        }

        if (details.url.includes("workwonders")) {
          return callback({
            ...details,
            requestHeaders: {
              Origin: "https://workwonders.app",
              ...details.requestHeaders,
            },
          });
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

    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
        if (
          details.webContentsId !== mainWindow.webContents.id ||
          details.url.includes("featurebase") ||
          details.url.includes("chatwoot") ||
          details.url.includes("workwonders")
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

    const initialHash =
      hashOverride ?? (userPreferences?.launchToLibraryPage ? "library" : "");

    void this.loadMainWindowURL(initialHash);
    mainWindow.removeMenu();

    mainWindow.on("ready-to-show", () => {
      if (!app.isPackaged || isStaging)
        mainWindow.webContents.openDevTools();

      WindowManager.focusWindow(mainWindow);
      WindowManager.completeModeSwitch("main");
      void WindowManager.refreshSystemTray();
    });

    mainWindow.on("close", async () => {
      const isModeSwitchClose = this.modeSwitchClosingWindows.has(mainWindow);

      if (this.mainWindow === mainWindow) {
        this.mainWindow = null;
      }

      mainWindow.setProgressBar(-1);

      const lastBounds = mainWindow.getBounds();
      const isMaximized = mainWindow.isMaximized() ?? false;
      const screenConfig = isMaximized
        ? {
            x: undefined,
            y: undefined,
            height: this.initialConfigInitializationMainWindow.height ?? 860,
            width: this.initialConfigInitializationMainWindow.width ?? 1200,
            isMaximized: true,
          }
        : { ...lastBounds, isMaximized };

      await this.saveScreenConfig(screenConfig);

      const latestUserPreferences = await this.getUserPreferences();

      if (latestUserPreferences?.preferQuitInsteadOfHiding && !isModeSwitchClose) {
        app.quit();
      }

      void this.refreshSystemTray();
    });

    mainWindow.on("closed", () => {
      this.modeSwitchClosingWindows.delete(mainWindow);
    });

    mainWindow.webContents.setWindowOpenHandler((handler) => {
      shell.openExternal(handler.url);
      return { action: "deny" };
    });

    return mainWindow;
  }

  public static async openBigPictureWindow() {
    const bigPicture = this.getBigPictureWindow();

    if (bigPicture) {
      this.focusWindow(bigPicture);

      const mainWindow = this.getMainWindow();
      if (mainWindow) {
        this.closeWindowForModeSwitch(mainWindow);
      }

      void this.refreshSystemTray();
      return;
    }

    const mainWindow = this.getMainWindow();
    if (mainWindow) {
      this.pendingModeSwitch = {
        sourceWindow: mainWindow,
        target: "big-picture",
      };
    }

    this.bigPicture = new BrowserWindow({
      fullscreen: true,
      backgroundColor: "#0a0a0a",
      icon,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });
    const bigPictureWindow = this.bigPicture;

    bigPictureWindow.removeMenu();

    if (!app.isPackaged || isStaging) {
      bigPictureWindow.webContents.openDevTools();
    }

    void this.loadWindowURL(bigPictureWindow, "big-picture");

    bigPictureWindow.once("ready-to-show", () => {
      this.focusWindow(bigPictureWindow);
      this.completeModeSwitch("big-picture");
      void this.refreshSystemTray();
    });

    bigPictureWindow.on("closed", async () => {
      const isModeSwitchClose = this.modeSwitchClosingWindows.has(bigPictureWindow);

      if (this.bigPicture === bigPictureWindow) {
        this.bigPicture = null;
      }

      this.modeSwitchClosingWindows.delete(bigPictureWindow);

      if (!isModeSwitchClose) {
        const userPreferences = await this.getUserPreferences();

        if (userPreferences?.preferQuitInsteadOfHiding) {
          app.quit();
        }
      }

      void this.refreshSystemTray();
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

  private static readonly NOTIFICATION_WINDOW_WIDTH = 360;
  private static readonly NOTIFICATION_WINDOW_HEIGHT = 140;

  private static async getNotificationWindowPosition(
    position: AchievementCustomNotificationPosition | undefined
  ) {
    const display = screen.getPrimaryDisplay();
    const {
      x: displayX,
      y: displayY,
      width: displayWidth,
      height: displayHeight,
    } = display.bounds;

    if (position === "bottom-left") {
      return {
        x: displayX,
        y: displayY + displayHeight - this.NOTIFICATION_WINDOW_HEIGHT,
      };
    }

    if (position === "bottom-center") {
      return {
        x: displayX + (displayWidth - this.NOTIFICATION_WINDOW_WIDTH) / 2,
        y: displayY + displayHeight - this.NOTIFICATION_WINDOW_HEIGHT,
      };
    }

    if (position === "bottom-right") {
      return {
        x: displayX + displayWidth - this.NOTIFICATION_WINDOW_WIDTH,
        y: displayY + displayHeight - this.NOTIFICATION_WINDOW_HEIGHT,
      };
    }

    if (position === "top-left") {
      return {
        x: displayX,
        y: displayY,
      };
    }

    if (position === "top-center") {
      return {
        x: displayX + (displayWidth - this.NOTIFICATION_WINDOW_WIDTH) / 2,
        y: displayY,
      };
    }

    if (position === "top-right") {
      return {
        x: displayX + displayWidth - this.NOTIFICATION_WINDOW_WIDTH,
        y: displayY,
      };
    }

    return {
      x: displayX,
      y: displayY,
    };
  }

  public static async createNotificationWindow() {
    if (this.notificationWindow) return;

    if (process.platform === "darwin") {
      return;
    }

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
    this.loadWindowURL(this.notificationWindow, "achievement-notification");

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
        this.mainWindow?.webContents.openDevTools();
        if (!app.isPackaged || isStaging) {
          editorWindow.webContents.openDevTools();
        }
      });

      editorWindow.webContents.on("before-input-event", (_event, input) => {
        if (input.key === "F12") {
          this.mainWindow?.webContents.toggleDevTools();
        }
      });

      editorWindow.on("close", () => {
        this.mainWindow?.webContents.closeDevTools();
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

  private static readonly GAME_LAUNCHER_WINDOW_WIDTH = 550;
  private static readonly GAME_LAUNCHER_WINDOW_HEIGHT = 320;

  public static async createGameLauncherWindow(shop: string, objectId: string) {
    if (this.gameLauncherWindow) {
      this.gameLauncherWindow.close();
      this.gameLauncherWindow = null;
    }

    const display = screen.getPrimaryDisplay();
    const { width: displayWidth, height: displayHeight } = display.bounds;

    const x = Math.round((displayWidth - this.GAME_LAUNCHER_WINDOW_WIDTH) / 2);
    const y = Math.round(
      (displayHeight - this.GAME_LAUNCHER_WINDOW_HEIGHT) / 2
    );

    this.gameLauncherWindow = new BrowserWindow({
      width: this.GAME_LAUNCHER_WINDOW_WIDTH,
      height: this.GAME_LAUNCHER_WINDOW_HEIGHT,
      x,
      y,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      frame: false,
      backgroundColor: "#1c1c1c",
      icon,
      skipTaskbar: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
    });

    this.gameLauncherWindow.removeMenu();

    this.loadWindowURL(
      this.gameLauncherWindow,
      `game-launcher?shop=${shop}&objectId=${objectId}`
    );

    this.gameLauncherWindow.on("closed", () => {
      this.gameLauncherWindow = null;
    });

    if (!app.isPackaged || isStaging) {
      this.gameLauncherWindow.webContents.openDevTools();
    }
  }

  public static showGameLauncherWindow() {
    if (this.gameLauncherWindow && !this.gameLauncherWindow.isDestroyed()) {
      this.gameLauncherWindow.show();
    }
  }

  public static closeGameLauncherWindow() {
    if (this.gameLauncherWindow) {
      this.gameLauncherWindow.close();
      this.gameLauncherWindow = null;
    }
  }

  public static async openPreferredWindow() {
    const existingWindow = this.getOpenAppWindow();

    if (existingWindow) {
      this.focusWindow(existingWindow);

      const mainWindow = this.getMainWindow();
      const bigPicture = this.getBigPictureWindow();

      if (existingWindow === bigPicture && mainWindow) {
        this.closeWindowForModeSwitch(mainWindow);
      } else if (existingWindow === mainWindow && bigPicture) {
        this.closeWindowForModeSwitch(bigPicture);
      }

      return;
    }

    const mode = await this.getCurrentOrPreferredMode();

    if (mode === "big-picture") {
      await this.openBigPictureWindow();
    } else {
      await this.openMainWindow();
    }
  }

  public static async openMainWindow(hash?: string) {
    const mainWindow = this.getMainWindow();

    if (mainWindow) {
      if (typeof hash === "string") {
        await this.loadMainWindowURL(hash);
      }

      this.focusWindow(mainWindow);

      const bigPicture = this.getBigPictureWindow();
      if (bigPicture) {
        this.closeWindowForModeSwitch(bigPicture);
      }

      void this.refreshSystemTray();
      return;
    }

    const bigPicture = this.getBigPictureWindow();
    if (bigPicture) {
      this.pendingModeSwitch = {
        sourceWindow: bigPicture,
        target: "main",
      };
    }

    await this.createMainWindow(hash);
  }

  public static async redirect(hash: string) {
    await this.openMainWindow(hash);
  }

  private static async buildSystemTrayMenu(language: string) {
    const currentOrPreferredMode = await this.getCurrentOrPreferredMode();
    const shouldOpenMainWindow = currentOrPreferredMode === "big-picture";
    const toggleKey = shouldOpenMainWindow
      ? "open_main_window"
      : "open_big_picture";

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

    return Menu.buildFromTemplate([
      {
        label: t("open", {
          ns: "system_tray",
          lng: language,
        }),
        type: "normal",
        click: () => {
          void this.openPreferredWindow();
        },
      },
      {
        label: t(toggleKey, {
          ns: "system_tray",
          lng: language,
        }),
        type: "normal",
        click: () => {
          if (shouldOpenMainWindow) {
            void this.openMainWindow();
          } else {
            void this.openBigPictureWindow();
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
  }

  private static async refreshSystemTray() {
    if (!this.systemTray) return null;

    const contextMenu = await this.buildSystemTrayMenu(this.systemTrayLanguage);

    if (process.platform === "linux") {
      this.systemTray.setContextMenu(contextMenu);
    }

    return contextMenu;
  }

  public static async createSystemTray(language: string) {
    this.systemTrayLanguage = language;

    if (!this.systemTray && process.platform === "darwin") {
      const macIcon = nativeImage
        .createFromPath(trayIcon)
        .resize({ width: 24, height: 24 });
      this.systemTray = new Tray(macIcon);
    } else if (!this.systemTray) {
      this.systemTray = new Tray(trayIcon);
    }
    const tray = this.systemTray;

    const showContextMenu = async () => {
      const contextMenu = await this.refreshSystemTray();
      if (!contextMenu) return;
      tray.popUpContextMenu(contextMenu);
    };

    tray.setToolTip("Hydra Launcher");

    if (process.platform === "win32") {
      await this.refreshSystemTray();

      tray.addListener("double-click", () => {
        void this.openPreferredWindow();
      });

      tray.addListener("right-click", showContextMenu);
    } else if (process.platform === "linux") {
      await this.refreshSystemTray();

      tray.addListener("click", () => {
        void this.openPreferredWindow();
      });

      tray.addListener("right-click", showContextMenu);
    } else {
      tray.addListener("click", showContextMenu);
      tray.addListener("right-click", showContextMenu);
    }
  }
}
