import { is } from "@electron-toolkit/utils";
import { isStaging } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import icon from "@resources/icon.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import { AuthPage, generateAchievementCustomNotificationTest } from "@shared";
import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  ScreenState,
  UserPreferences,
} from "@types";
import {
  BrowserWindow,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  Tray,
  WebContentsView,
  app,
  nativeImage,
  screen,
  shell,
} from "electron";
import { t } from "i18next";
import { orderBy } from "lodash-es";
import path from "node:path";
import UserAgent from "user-agents";
import { BigPictureSessionManager } from "./big-picture-session-manager";
import { DisplayManager } from "./display-manager";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import {
  addSteamGridDbCacheControl,
  isSteamGridDbArtworkRequest,
} from "./steam-grid-db-cache";

const isLinuxWayland =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

const BIG_PICTURE_FULLSCREEN_TOGGLE_DELAY_MS = 150;
const LINUX_BIG_PICTURE_PLACEMENT_RETRY_DELAYS_MS = [
  100, 500, 1_000, 2_000,
] as const;

interface CreateMainWindowOptions {
  forceBigPicture?: boolean;
}

export class WindowManager {
  private static mainWindowInstance: Electron.BrowserWindow | null = null;
  private static notificationWindowInstance: Electron.BrowserWindow | null =
    null;
  private static gameLauncherWindowInstance: Electron.BrowserWindow | null =
    null;
  private static bigPicture: Electron.BrowserWindow | null = null;
  private static friendsWindow: Electron.BrowserWindow | null = null;
  private static authWindow: Electron.BrowserWindow | null = null;
  private static deferredMainMaximize = false;

  private static isArtworkRendererRequest(
    webContentsId: number | undefined
  ): boolean {
    return [this.mainWindow, this.bigPicture].some(
      (window) =>
        window != null &&
        !window.isDestroyed() &&
        window.webContents.id === webContentsId
    );
  }

  private static readonly editorWindows: Map<string, BrowserWindow> = new Map();

  public static get mainWindow(): Electron.BrowserWindow | null {
    return this.mainWindowInstance;
  }

  public static get notificationWindow(): Electron.BrowserWindow | null {
    return this.notificationWindowInstance;
  }

  public static get gameLauncherWindow(): Electron.BrowserWindow | null {
    return this.gameLauncherWindowInstance;
  }

  public static clearMainWindow(): void {
    this.mainWindowInstance = null;
  }

  private static initialConfigInitializationMainWindow: Electron.BrowserWindowConstructorOptions =
    {
      width: 1200,
      height: 860,
      minWidth: 1024,
      minHeight: 860,
      icon,
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
      ...(process.platform === "linux"
        ? {
            frame: false,
            ...(isLinuxWayland
              ? { transparent: true, backgroundColor: "#00000000" }
              : { backgroundColor: "#1c1c1c" }),
          }
        : {
            backgroundColor: "#1c1c1c",
            titleBarStyle: "hidden",
            titleBarOverlay: {
              symbolColor: "#DADBE1",
              color: "#00000000",
              height: 34,
            },
          }),
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

  private static disableMainWindowWhileBigPictureIsOpen() {
    const main = this.mainWindow;

    if (!main || main.isDestroyed()) return;

    main.setFocusable(false);
    main.setIgnoreMouseEvents(true);
    main.hide();
  }

  private static restoreMainWindowAfterBigPictureCloses() {
    const main = this.mainWindow;

    if (!main || main.isDestroyed()) return;

    main.setIgnoreMouseEvents(false);
    main.setFocusable(true);
    main.setSkipTaskbar(false);
  }

  private static placeBigPictureWindowOnDisplay(
    window: BrowserWindow,
    display: Electron.Display
  ) {
    const targetBounds =
      process.platform === "linux" ? display.workArea : display.bounds;

    window.setBounds(
      {
        x: targetBounds.x,
        y: targetBounds.y,
        width: targetBounds.width,
        height: targetBounds.height,
      },
      false
    );
    window.setPosition(targetBounds.x, targetBounds.y, false);
    window.setSize(targetBounds.width, targetBounds.height, false);
  }

  private static useNativeBigPictureFullscreen() {
    return process.platform !== "linux";
  }

  private static isActiveBigPictureWindow(window: BrowserWindow) {
    return this.bigPicture === window && !window.isDestroyed();
  }

  private static presentBigPictureWindow(
    window: BrowserWindow,
    display: Electron.Display
  ) {
    this.placeBigPictureWindowOnDisplay(window, display);

    if (this.useNativeBigPictureFullscreen()) {
      window.setFullScreen(true);
      return;
    }

    window.setVisibleOnAllWorkspaces(false);
    this.placeBigPictureWindowOnDisplay(window, display);
  }

  private static scheduleBigPictureWindowPlacement(display: Electron.Display) {
    if (process.platform !== "linux") return;

    for (const delayMs of LINUX_BIG_PICTURE_PLACEMENT_RETRY_DELAYS_MS) {
      setTimeout(() => {
        if (!this.bigPicture || this.bigPicture.isDestroyed()) {
          return;
        }

        this.placeBigPictureWindowOnDisplay(this.bigPicture, display);
        this.bigPicture.moveTop();
        this.bigPicture.focus();
      }, delayMs);
    }
  }

  public static sendToAppWindows(channel: string, ...args: unknown[]) {
    const windows = [this.mainWindow, this.bigPicture, this.friendsWindow];

    for (const window of windows) {
      if (!window || window.isDestroyed()) continue;
      window.webContents.send(channel, ...args);
    }
  }

  public static sendDownloadsUpdated() {
    this.sendToAppWindows("on-downloads-updated");
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

  public static async createMainWindow(options?: CreateMainWindowOptions) {
    if (this.mainWindow) return;

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const { isMaximized = false, ...configWithoutMaximized } =
      await this.loadScreenConfig();

    this.updateInitialConfig(configWithoutMaximized);

    const mainWindow = new BrowserWindow(
      this.initialConfigInitializationMainWindow
    );
    this.mainWindowInstance = mainWindow;

    this.deferredMainMaximize = false;

    const emitMaximizeState = () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          "on-window-maximize-change",
          mainWindow.isMaximized()
        );
      }
    };
    mainWindow.on("maximize", emitMaximizeState);
    mainWindow.on("unmaximize", emitMaximizeState);

    const shouldLaunchInBigPicture =
      options?.forceBigPicture || Boolean(userPreferences?.launchInBigPicture);

    if (shouldLaunchInBigPicture) {
      mainWindow.setOpacity(0);
      mainWindow.setSkipTaskbar(true);
      if (isMaximized) {
        this.deferredMainMaximize = true;
      }
    } else if (isMaximized) {
      mainWindow.maximize();
    }

    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (
          !this.isArtworkRendererRequest(details.webContentsId) ||
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
        const isArtworkRendererRequest = this.isArtworkRendererRequest(
          details.webContentsId
        );
        const responseHeaders =
          isArtworkRendererRequest && isSteamGridDbArtworkRequest(details)
            ? addSteamGridDbCacheControl(details.responseHeaders)
            : details.responseHeaders;

        if (
          !isArtworkRendererRequest ||
          details.url.includes("featurebase") ||
          details.url.includes("chatwoot") ||
          details.url.includes("workwonders")
        ) {
          return callback({ ...details, responseHeaders });
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
              ...responseHeaders,
              ...headers,
            },
            statusLine: "HTTP/1.1 200 OK",
          });
        }

        return callback({
          responseHeaders: {
            ...responseHeaders,
            ...headers,
          },
        });
      }
    );

    const initialHash = userPreferences?.launchToLibraryPage ? "library" : "";

    this.loadMainWindowURL(initialHash);
    mainWindow.removeMenu();

    mainWindow.on("ready-to-show", () => {
      if (!app.isPackaged || isStaging)
        WindowManager.mainWindow?.webContents.openDevTools();
      if (shouldLaunchInBigPicture) {
        void WindowManager.openBigPictureWindow();
      } else {
        WindowManager.mainWindow?.show();
      }
    });

    mainWindow.on("close", async () => {
      this.mainWindowInstance = null;

      const userPreferences = await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

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

      if (userPreferences?.preferQuitInsteadOfHiding) {
        app.quit();
      }
    });

    mainWindow.webContents.setWindowOpenHandler((handler) => {
      shell.openExternal(handler.url);
      return { action: "deny" };
    });
  }

  public static async openBigPictureWindow() {
    if (this.bigPicture) {
      await this.applyBigPictureDisplayPreference();
      this.bigPicture.focus();
      return;
    }

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    await BigPictureSessionManager.apply();
    const targetDisplay = await DisplayManager.getBigPictureDisplay();
    const targetBounds =
      process.platform === "linux"
        ? targetDisplay.workArea
        : targetDisplay.bounds;

    this.bigPicture = new BrowserWindow({
      x: targetBounds.x,
      y: targetBounds.y,
      width: targetBounds.width,
      height: targetBounds.height,
      backgroundColor: "#0a0a0a",
      icon,
      frame: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    this.bigPicture.removeMenu();

    if (!app.isPackaged || isStaging) {
      this.bigPicture.webContents.openDevTools();
    }

    const bigPictureInitialHash = userPreferences?.launchToLibraryPage
      ? "big-picture/library"
      : "big-picture";

    this.loadWindowURL(this.bigPicture, bigPictureInitialHash);

    this.bigPicture.once("ready-to-show", () => {
      const main = this.mainWindow;
      if (main && !main.isDestroyed()) {
        main.setOpacity(1);
        this.disableMainWindowWhileBigPictureIsOpen();
      }

      if (this.bigPicture && !this.bigPicture.isDestroyed()) {
        this.placeBigPictureWindowOnDisplay(this.bigPicture, targetDisplay);
      }

      if (this.bigPicture && !this.bigPicture.isDestroyed()) {
        this.bigPicture.show();
        this.placeBigPictureWindowOnDisplay(this.bigPicture, targetDisplay);
        this.presentBigPictureWindow(this.bigPicture, targetDisplay);
        this.scheduleBigPictureWindowPlacement(targetDisplay);
      }
      this.bigPicture?.focus();
    });

    this.bigPicture.on("closed", () => {
      this.bigPicture = null;
      const main = this.mainWindow;
      if (main && !main.isDestroyed()) {
        this.restoreMainWindowAfterBigPictureCloses();
        if (WindowManager.deferredMainMaximize) {
          main.maximize();
          WindowManager.deferredMainMaximize = false;
        }
        main.show();
        main.focus();
      }

      BigPictureSessionManager.restore().catch((error) => {
        logger.warn("Failed to restore Big Picture session settings", error);
      });
    });
  }

  public static async applyBigPictureDisplayPreference() {
    const bigPicture = this.bigPicture;

    if (!bigPicture || bigPicture.isDestroyed()) {
      return;
    }

    const targetDisplay = await DisplayManager.getBigPictureDisplay();

    if (!this.isActiveBigPictureWindow(bigPicture)) {
      return;
    }

    const wasFullScreen = bigPicture.isFullScreen();

    if (wasFullScreen) {
      bigPicture.setFullScreen(false);
      await new Promise((resolve) =>
        setTimeout(resolve, BIG_PICTURE_FULLSCREEN_TOGGLE_DELAY_MS)
      );

      if (!this.isActiveBigPictureWindow(bigPicture)) {
        return;
      }
    }

    this.presentBigPictureWindow(bigPicture, targetDisplay);
    this.scheduleBigPictureWindowPlacement(targetDisplay);

    if (wasFullScreen && this.useNativeBigPictureFullscreen()) {
      await new Promise((resolve) =>
        setTimeout(resolve, BIG_PICTURE_FULLSCREEN_TOGGLE_DELAY_MS)
      );

      if (!this.isActiveBigPictureWindow(bigPicture)) {
        return;
      }

      this.placeBigPictureWindowOnDisplay(bigPicture, targetDisplay);
    }

    if (!this.isActiveBigPictureWindow(bigPicture)) {
      return;
    }

    bigPicture.show();
    bigPicture.focus();
  }

  public static openFriendsWindow() {
    if (this.friendsWindow) {
      if (this.friendsWindow.isMinimized()) {
        this.friendsWindow.restore();
      }
      this.friendsWindow.focus();
      return;
    }

    this.friendsWindow = new BrowserWindow({
      width: 420,
      height: 780,
      minWidth: 420,
      maxWidth: 420,
      minHeight: 560,
      maximizable: false,
      backgroundColor: "#1c1c1c",
      // No native frame/controls — the renderer draws its own minimize and
      // close buttons in the title bar (see friends-window.tsx).
      frame: false,
      icon,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
      show: false,
    });

    this.friendsWindow.removeMenu();

    this.loadWindowURL(this.friendsWindow, "friends-window");

    this.friendsWindow.once("ready-to-show", () => {
      this.friendsWindow?.show();
      if (!app.isPackaged || isStaging) {
        this.friendsWindow?.webContents.openDevTools();
      }
    });

    this.friendsWindow.on("closed", () => {
      this.friendsWindow = null;
    });
  }

  public static minimizeFriendsWindow() {
    if (this.friendsWindow && !this.friendsWindow.isDestroyed()) {
      this.friendsWindow.minimize();
    }
  }

  public static closeFriendsWindow() {
    if (this.friendsWindow && !this.friendsWindow.isDestroyed()) {
      this.friendsWindow.close();
    }
    this.friendsWindow = null;
  }

  public static minimizeMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.minimize();
    }
  }

  public static toggleMaximizeMainWindow() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMaximized()) {
      this.mainWindow.unmaximize();
    } else {
      this.mainWindow.maximize();
    }
  }

  public static closeMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.close();
    }
  }

  public static isMainWindowMaximized() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
    return this.mainWindow.isMaximized();
  }

  private static focusMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    } else {
      this.createMainWindow();
    }
  }

  public static focusMainWindowAndNavigate(path: string) {
    this.focusMainWindow();
    this.mainWindow?.webContents.send("on-navigate", path);
  }

  public static openAddFriendModalInMainWindow() {
    this.focusMainWindow();
    this.mainWindow?.webContents.send("on-open-add-friend-modal");
  }

  private static readonly AUTH_WINDOW_WIDTH = 600;
  private static readonly AUTH_WINDOW_HEIGHT = 640;
  private static readonly AUTH_WINDOW_TITLE_BAR_HEIGHT = 34;
  private static readonly AUTH_WINDOW_BORDER = 1;

  private static bindAuthNavigation(
    contents: Electron.WebContents,
    closeWindow: () => void
  ) {
    contents.on("will-navigate", (_event, url) => {
      if (url.startsWith("hydralauncher://auth")) {
        closeWindow();

        HydraApi.handleExternalAuth(url);
        return;
      }

      if (url.startsWith("hydralauncher://update-account")) {
        closeWindow();

        WindowManager.sendToAppWindows("on-account-updated");
      }
    });
  }

  public static openAuthWindow(page: AuthPage, searchParams: URLSearchParams) {
    const parentWindow =
      this.bigPicture && !this.bigPicture.isDestroyed()
        ? this.bigPicture
        : this.mainWindow;

    if (!parentWindow || parentWindow.isDestroyed()) return;

    const authUrl = `${import.meta.env.MAIN_VITE_AUTH_URL}${page}?${searchParams.toString()}`;

    if (process.platform === "linux") {
      this.openLinuxAuthWindow(parentWindow, authUrl);
      return;
    }

    const authWindow = new BrowserWindow({
      width: this.AUTH_WINDOW_WIDTH,
      height: this.AUTH_WINDOW_HEIGHT,
      backgroundColor: "#1c1c1c",
      parent: parentWindow,
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

    authWindow.loadURL(authUrl);

    authWindow.once("ready-to-show", () => {
      authWindow.show();
    });

    authWindow.once("closed", () => {
      if (!parentWindow.isDestroyed()) {
        parentWindow.focus();
      }
    });

    this.bindAuthNavigation(authWindow.webContents, () => authWindow.close());
  }

  private static openLinuxAuthWindow(
    parentWindow: Electron.BrowserWindow,
    authUrl: string
  ) {
    const authWindow = new BrowserWindow({
      width: this.AUTH_WINDOW_WIDTH + this.AUTH_WINDOW_BORDER * 2,
      height:
        this.AUTH_WINDOW_HEIGHT +
        this.AUTH_WINDOW_TITLE_BAR_HEIGHT +
        this.AUTH_WINDOW_BORDER * 2,
      parent: parentWindow,
      modal: true,
      show: false,
      maximizable: false,
      resizable: false,
      frame: false,
      icon,
      backgroundColor: "#1c1c1c",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    this.authWindow = authWindow;

    authWindow.removeMenu();

    const authView = new WebContentsView({
      webPreferences: {
        sandbox: false,
        nodeIntegrationInSubFrames: true,
      },
    });

    authWindow.contentView.addChildView(authView);
    authView.setBounds({
      x: this.AUTH_WINDOW_BORDER,
      y: this.AUTH_WINDOW_BORDER + this.AUTH_WINDOW_TITLE_BAR_HEIGHT,
      width: this.AUTH_WINDOW_WIDTH,
      height: this.AUTH_WINDOW_HEIGHT,
    });

    this.loadWindowURL(authWindow, "auth-window");
    authView.webContents.loadURL(authUrl);

    if (!app.isPackaged) authView.webContents.openDevTools();

    authWindow.once("ready-to-show", () => {
      authWindow.show();
    });

    authWindow.once("closed", () => {
      this.authWindow = null;
      if (!parentWindow.isDestroyed()) {
        parentWindow.focus();
      }
    });

    this.bindAuthNavigation(authView.webContents, () => {
      if (!authWindow.isDestroyed()) authWindow.close();
    });
  }

  public static minimizeAuthWindow() {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.minimize();
    }
  }

  public static closeAuthWindow() {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.close();
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

  public static sendAchievementToFocusedWindow(
    position: AchievementCustomNotificationPosition,
    achievements: AchievementNotificationInfo[]
  ): boolean {
    const candidates = [this.bigPicture, this.mainWindow];

    for (const window of candidates) {
      if (window && !window.isDestroyed() && window.isFocused()) {
        window.webContents.send(
          "on-achievement-unlocked-in-app",
          position,
          achievements
        );
        return true;
      }
    }

    return false;
  }

  public static async createNotificationWindow() {
    if (this.notificationWindow) return;

    if (process.platform === "darwin" || process.platform === "linux") {
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

    const notificationWindow = new BrowserWindow({
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
    this.notificationWindowInstance = notificationWindow;
    notificationWindow.setIgnoreMouseEvents(true);

    notificationWindow.setAlwaysOnTop(true, "screen-saver", 1);
    this.loadWindowURL(notificationWindow, "achievement-notification");

    if (!app.isPackaged || isStaging) {
      notificationWindow.webContents.openDevTools();
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
    const position =
      userPreferences.achievementCustomNotificationPosition ?? "top-left";
    const testAchievements = [
      generateAchievementCustomNotificationTest(t, language),
      generateAchievementCustomNotificationTest(t, language, {
        isRare: true,
        isHidden: true,
      }),
      generateAchievementCustomNotificationTest(t, language, {
        isPlatinum: true,
      }),
    ];

    if (process.platform === "linux") {
      this.sendAchievementToFocusedWindow(position, testAchievements);
      return;
    }

    this.notificationWindow?.webContents.send(
      "on-achievement-unlocked",
      position,
      testAchievements
    );
  }

  public static async closeNotificationWindow() {
    if (this.notificationWindow) {
      this.notificationWindow.close();
      this.notificationWindowInstance = null;
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

  public static async createGameLauncherWindow(
    shop: string,
    objectId: string,
    targetDisplay?: Electron.Display
  ) {
    if (this.gameLauncherWindow) {
      this.gameLauncherWindow.close();
      this.gameLauncherWindowInstance = null;
    }

    const display = targetDisplay ?? screen.getPrimaryDisplay();
    const {
      x: displayX,
      y: displayY,
      width: displayWidth,
      height: displayHeight,
    } = display.bounds;

    const x = Math.round(
      displayX + (displayWidth - this.GAME_LAUNCHER_WINDOW_WIDTH) / 2
    );
    const y = Math.round(
      displayY + (displayHeight - this.GAME_LAUNCHER_WINDOW_HEIGHT) / 2
    );

    const gameLauncherWindow = new BrowserWindow({
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
    this.gameLauncherWindowInstance = gameLauncherWindow;

    gameLauncherWindow.removeMenu();

    this.loadWindowURL(
      gameLauncherWindow,
      `game-launcher?shop=${shop}&objectId=${objectId}`
    );

    gameLauncherWindow.on("closed", () => {
      this.gameLauncherWindowInstance = null;
    });

    if (!app.isPackaged || isStaging) {
      gameLauncherWindow.webContents.openDevTools();
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
      this.gameLauncherWindowInstance = null;
    }
  }

  public static openMainWindow() {
    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      this.bigPicture.focus();
      return;
    }

    if (this.mainWindow) {
      this.mainWindow.show();
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    } else {
      this.createMainWindow();
    }
  }

  public static redirect(hash: string) {
    if (!this.mainWindow) this.createMainWindow();
    this.loadMainWindowURL(hash);

    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      return;
    }

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

          return sortedGames.slice(0, 6);
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
