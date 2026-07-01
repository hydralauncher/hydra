import { is } from "@electron-toolkit/utils";
import { isStaging } from "@main/constants";
import { db, gamesSublevel, levelKeys, themesSublevel } from "@main/level";
import icon from "@resources/icon.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import {
  AuthPage,
  DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER,
  generateAchievementCustomNotificationTest,
  getActiveAchievementNotificationTheme,
  getAchievementNotificationPosition,
  getAchievementNotificationVariation,
  getAchievementNotificationWindowPosition,
  getAchievementNotificationWindowSize,
  getThemeAchievementNotificationCustomizer,
} from "@shared";
import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  AchievementNotificationVariation,
  ScreenState,
  UserPreferences,
} from "@types";
import {
  BrowserWindow,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  Notification,
  Tray,
  WebContentsView,
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

const isLinuxWayland =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

export class WindowManager {
  public static mainWindow: Electron.BrowserWindow | null = null;
  public static notificationWindow: Electron.BrowserWindow | null = null;
  public static gameLauncherWindow: Electron.BrowserWindow | null = null;
  private static bigPicture: Electron.BrowserWindow | null = null;
  private static friendsWindow: Electron.BrowserWindow | null = null;
  private static authWindow: Electron.BrowserWindow | null = null;
  private static achievementNotificationCustomizerWindow: Electron.BrowserWindow | null =
    null;
  private static deferredMainMaximize = false;

  private static readonly editorWindows: Map<string, BrowserWindow> = new Map();

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

  public static async createMainWindow() {
    if (this.mainWindow) return;

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const { isMaximized = false, ...configWithoutMaximized } =
      await this.loadScreenConfig();

    this.updateInitialConfig(configWithoutMaximized);

    this.mainWindow = new BrowserWindow(
      this.initialConfigInitializationMainWindow
    );

    this.deferredMainMaximize = false;

    const emitMaximizeState = () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(
          "on-window-maximize-change",
          this.mainWindow.isMaximized()
        );
      }
    };
    this.mainWindow.on("maximize", emitMaximizeState);
    this.mainWindow.on("unmaximize", emitMaximizeState);

    if (userPreferences?.launchInBigPicture) {
      this.mainWindow.setOpacity(0);
      this.mainWindow.setSkipTaskbar(true);
      if (isMaximized) {
        this.deferredMainMaximize = true;
      }
    } else if (isMaximized) {
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

    this.mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
        if (
          details.webContentsId !== this.mainWindow?.webContents.id ||
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

    const initialHash = userPreferences?.launchToLibraryPage ? "library" : "";

    this.loadMainWindowURL(initialHash);
    this.mainWindow.removeMenu();

    this.mainWindow.on("ready-to-show", () => {
      if (!app.isPackaged || isStaging)
        WindowManager.mainWindow?.webContents.openDevTools();
      if (userPreferences?.launchInBigPicture) {
        void WindowManager.openBigPictureWindow();
      } else {
        WindowManager.mainWindow?.show();
      }
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
              height: this.initialConfigInitializationMainWindow.height ?? 860,
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

  public static async openBigPictureWindow() {
    if (this.bigPicture) {
      this.bigPicture.focus();
      return;
    }

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const targetDisplay = this.mainWindow?.isDestroyed()
      ? null
      : this.mainWindow
        ? screen.getDisplayMatching(this.mainWindow.getBounds())
        : screen.getPrimaryDisplay();
    const targetBounds =
      targetDisplay?.bounds ?? screen.getPrimaryDisplay().bounds;

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
      this.bigPicture?.show();
      this.bigPicture?.setFullScreen(true);
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
    });
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

  private static async getNotificationWindowSize(useDefaultProfile = false) {
    if (useDefaultProfile) {
      return getAchievementNotificationWindowSize({
        achievementNotificationCustomizer:
          DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER,
      });
    }

    const allThemes = await themesSublevel.values().all();
    const activeNotificationTheme =
      getActiveAchievementNotificationTheme(allThemes);
    return getAchievementNotificationWindowSize(activeNotificationTheme);
  }

  public static async getAchievementNotificationPosition(
    achievement?: Pick<
      AchievementNotificationInfo,
      "isRare" | "isPlatinum" | "isHidden"
    >,
    fallbackVariation: AchievementNotificationVariation = "main"
  ) {
    const [allThemes, userPreferences] = await Promise.all([
      themesSublevel.values().all(),
      db.get<string, UserPreferences | undefined>(levelKeys.userPreferences, {
        valueEncoding: "json",
      }),
    ]);
    const activeNotificationTheme =
      getActiveAchievementNotificationTheme(allThemes);
    const fallback =
      userPreferences?.achievementCustomNotificationPosition ?? "top-left";

    if (!activeNotificationTheme) return fallback;

    const variation = achievement
      ? getAchievementNotificationVariation(achievement)
      : fallbackVariation;
    const customizer = getThemeAchievementNotificationCustomizer(
      activeNotificationTheme
    );

    return getAchievementNotificationPosition(customizer, variation, fallback);
  }

  private static async getNotificationWindowPosition(
    position: AchievementCustomNotificationPosition | undefined,
    size = {
      width: this.NOTIFICATION_WINDOW_WIDTH,
      height: this.NOTIFICATION_WINDOW_HEIGHT,
    }
  ) {
    const display = screen.getPrimaryDisplay();
    const {
      x: displayX,
      y: displayY,
      width: displayWidth,
      height: displayHeight,
    } = display.workArea;

    return getAchievementNotificationWindowPosition(
      position,
      {
        x: displayX,
        y: displayY,
        width: displayWidth,
        height: displayHeight,
      },
      size
    );
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

  public static hasFocusedAchievementNotificationTarget(): boolean {
    const candidates = [this.bigPicture, this.mainWindow];

    return candidates.some(
      (window) => window && !window.isDestroyed() && window.isFocused()
    );
  }

  public static async createNotificationWindow({
    forceCustomNotification = false,
    useDefaultProfile = false,
  }: {
    forceCustomNotification?: boolean;
    useDefaultProfile?: boolean;
  } = {}) {
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
      (!forceCustomNotification &&
        userPreferences?.achievementCustomNotificationsEnabled === false)
    ) {
      return;
    }

    const size = await this.getNotificationWindowSize(useDefaultProfile);
    const position = await this.getAchievementNotificationPosition();
    const { x, y } = await this.getNotificationWindowPosition(position, size);
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);

    this.notificationWindow = new BrowserWindow({
      transparent: true,
      maximizable: false,
      autoHideMenuBar: true,
      minimizable: false,
      backgroundColor: "#00000000",
      focusable: false,
      skipTaskbar: true,
      frame: false,
      width: size.width,
      height: size.height,
      x: roundedX,
      y: roundedY,
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

  public static async showAchievementTestNotification(
    variation: AchievementNotificationVariation = "main",
    positionOverride?: AchievementCustomNotificationPosition
  ) {
    const userPreferences = await db.get<string, UserPreferences>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );

    const language = userPreferences.language ?? "en";
    const testAchievements = [
      generateAchievementCustomNotificationTest(t, language, {
        isRare: variation === "rare",
        isPlatinum: variation === "platinum",
        isHidden: variation === "rare",
      }),
    ];

    if (userPreferences.achievementNotificationsEnabled === false) {
      return;
    }

    const shouldUseDefaultProfile =
      userPreferences.achievementCustomNotificationsEnabled === false;
    const position =
      positionOverride ??
      (shouldUseDefaultProfile
        ? getAchievementNotificationPosition(
            DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER,
            variation
          )
        : await this.getAchievementNotificationPosition(
            testAchievements[0],
            variation
          ));

    if (process.platform === "linux") {
      const shownInApp = this.sendAchievementToFocusedWindow(
        position,
        testAchievements
      );

      if (!shownInApp) {
        new Notification({
          title: testAchievements[0].title,
          body: testAchievements[0].description,
          icon,
        }).show();
      }
      return;
    }

    if (!this.notificationWindow) {
      await this.createNotificationWindow({
        forceCustomNotification: shouldUseDefaultProfile,
        useDefaultProfile: shouldUseDefaultProfile,
      });
    }

    if (!this.notificationWindow) return;

    if (this.notificationWindow.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1500);
        this.notificationWindow?.webContents.once("did-finish-load", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    await this.updateNotificationWindowPosition(
      position,
      shouldUseDefaultProfile
    );
    this.notificationWindow?.webContents.send(
      "on-achievement-unlocked",
      position,
      testAchievements
    );
  }

  public static async updateNotificationWindowPosition(
    position: AchievementCustomNotificationPosition,
    useDefaultProfile = false
  ) {
    if (!this.notificationWindow) return;

    const size = await this.getNotificationWindowSize(useDefaultProfile);
    const { x, y } = await this.getNotificationWindowPosition(position, size);

    this.notificationWindow.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: size.width,
      height: size.height,
    });
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

  public static openAchievementNotificationCustomizerWindow() {
    if (this.achievementNotificationCustomizerWindow) {
      if (this.achievementNotificationCustomizerWindow.isMinimized()) {
        this.achievementNotificationCustomizerWindow.restore();
      }
      this.achievementNotificationCustomizerWindow.focus();
      return;
    }

    const customizerWindow = new BrowserWindow({
      width: 1100,
      height: 820,
      minWidth: 920,
      minHeight: 680,
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

    this.achievementNotificationCustomizerWindow = customizerWindow;
    customizerWindow.removeMenu();
    this.loadWindowURL(customizerWindow, "achievement-notification-customizer");

    customizerWindow.once("ready-to-show", () => {
      customizerWindow.show();
      if (!app.isPackaged || isStaging) {
        customizerWindow.webContents.openDevTools();
      }
    });

    customizerWindow.webContents.on("before-input-event", (_event, input) => {
      if (input.key === "F12") {
        customizerWindow.webContents.toggleDevTools();
      }
    });

    customizerWindow.on("close", () => {
      this.achievementNotificationCustomizerWindow = null;
    });
  }

  public static closeAchievementNotificationCustomizerWindow() {
    this.achievementNotificationCustomizerWindow?.close();
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
