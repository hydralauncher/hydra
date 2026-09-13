import { is } from "@electron-toolkit/utils";
import { isStaging } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import icon from "@resources/icon.png?asset";
import trayIconDark from "@resources/tray-icon-dark.png?asset";
import trayIcon from "@resources/tray-icon.png?asset";
import { AuthPage } from "@shared";
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
  nativeTheme,
  screen,
  shell,
} from "electron";
import { t } from "i18next";
import { orderBy } from "lodash-es";
import path from "node:path";
import UserAgent from "user-agents";
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

interface CreateMainWindowOptions {
  forceBigPicture?: boolean;
}

export class WindowManager {
  private static mainWindowInstance: Electron.BrowserWindow | null = null;
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
  private static readonly themePreviewViews: Map<string, WebContentsView> =
    new Map();

  public static get mainWindow(): Electron.BrowserWindow | null {
    return this.mainWindowInstance;
  }

  public static get gameLauncherWindow(): Electron.BrowserWindow | null {
    return this.gameLauncherWindowInstance;
  }

  public static clearMainWindow(): void {
    this.mainWindowInstance = null;
  }

  private static readonly DEFAULT_WINDOW_WIDTH = 1200;
  private static readonly DEFAULT_WINDOW_HEIGHT = 860;
  private static readonly MIN_WINDOW_WIDTH = 1024;
  private static readonly MIN_WINDOW_HEIGHT = 600;

  private static initialConfigInitializationMainWindow: Electron.BrowserWindowConstructorOptions =
    {
      width: WindowManager.DEFAULT_WINDOW_WIDTH,
      height: WindowManager.DEFAULT_WINDOW_HEIGHT,
      minWidth: WindowManager.MIN_WINDOW_WIDTH,
      minHeight: WindowManager.MIN_WINDOW_HEIGHT,
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

  private static async loadWindowURLForView(view: WebContentsView) {
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      await view.webContents.loadURL(
        `${process.env["ELECTRON_RENDERER_URL"]}#/`
      );
    } else if (import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN) {
      try {
        await view.webContents.loadURL(
          `https://release-v${this.formatVersionNumber(app.getVersion())}.${import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN}#/`
        );
      } catch (error) {
        logger.error(error);
      }
    } else {
      await view.webContents.loadFile(
        path.join(__dirname, "../renderer/index.html"),
        { hash: "/" }
      );
    }
  }

  public static async loadWindowURL(window: BrowserWindow, hash: string = "") {
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
    return (
      data ?? {
        isMaximized: false,
        height: this.DEFAULT_WINDOW_HEIGHT,
        width: this.DEFAULT_WINDOW_WIDTH,
      }
    );
  }

  private static fitToWorkArea<
    T extends { x?: number; y?: number; width?: number; height?: number },
  >(bounds: T) {
    const savedWidth = bounds.width ?? this.DEFAULT_WINDOW_WIDTH;
    const savedHeight = bounds.height ?? this.DEFAULT_WINDOW_HEIGHT;
    const savedX = bounds.x;
    const savedY = bounds.y;
    const hasSavedPosition = savedX !== undefined && savedY !== undefined;

    const { workArea } = hasSavedPosition
      ? screen.getDisplayMatching({
          x: savedX,
          y: savedY,
          width: savedWidth,
          height: savedHeight,
        })
      : screen.getPrimaryDisplay();

    const minWidth = Math.min(this.MIN_WINDOW_WIDTH, workArea.width);
    const minHeight = Math.min(this.MIN_WINDOW_HEIGHT, workArea.height);

    const width = Math.max(minWidth, Math.min(savedWidth, workArea.width));
    const height = Math.max(minHeight, Math.min(savedHeight, workArea.height));

    if (!hasSavedPosition) {
      return { ...bounds, minWidth, minHeight, width, height };
    }

    const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);

    return {
      ...bounds,
      minWidth,
      minHeight,
      width,
      height,
      x: Math.min(Math.max(savedX, workArea.x), maxX),
      y: Math.min(Math.max(savedY, workArea.y), maxY),
    };
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

    this.updateInitialConfig(this.fitToWorkArea(configWithoutMaximized));

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
            height:
              this.initialConfigInitializationMainWindow.height ??
              this.DEFAULT_WINDOW_HEIGHT,
            width:
              this.initialConfigInitializationMainWindow.width ??
              this.DEFAULT_WINDOW_WIDTH,
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
      this.bigPicture.focus();
      return;
    }

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const mainWindow = this.mainWindow;
    const targetDisplay =
      mainWindow && !mainWindow.isDestroyed()
        ? screen.getDisplayMatching(mainWindow.getBounds())
        : screen.getPrimaryDisplay();
    const targetBounds = targetDisplay.bounds;

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

    const bigPictureInitialHash =
      (userPreferences?.bigPictureLaunchToLibraryPage ??
      userPreferences?.launchToLibraryPage)
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

  public static handleThemePreviewElementClicked(
    webContentsId: number,
    selectors: string[]
  ) {
    for (const [themeId, view] of this.themePreviewViews) {
      if (view.webContents.id !== webContentsId) continue;
      const editorWindow = this.editorWindows.get(themeId);
      if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send(
          "on-theme-preview-element-clicked",
          selectors
        );
      }
      return;
    }
  }

  public static updateThemePreviewBounds(
    themeId: string,
    bounds: { x: number; y: number; width: number; height: number }
  ) {
    const view = this.themePreviewViews.get(themeId);
    const editorWindow = this.editorWindows.get(themeId);
    if (
      !view ||
      view.webContents.isDestroyed() ||
      !editorWindow ||
      editorWindow.isDestroyed()
    )
      return;
    const { width: windowWidth, height: windowHeight } =
      editorWindow.getContentBounds();

    // width/height <= 0 é o sinal do renderer de que o Hydra real
    // NÃO deve aparecer. Isso acontece em Código CSS e Assets.
    if (bounds.width <= 0 || bounds.height <= 0) {
      view.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      return;
    }

    const x = Math.max(0, Math.round(bounds.x));
    const y = Math.max(0, Math.round(bounds.y));

    const maxWidth = Math.max(1, windowWidth - x);
    const maxHeight = Math.max(1, windowHeight - y);

    view.setBounds({
      x,
      y,
      width: Math.min(Math.max(1, Math.round(bounds.width)), maxWidth),
      height: Math.min(Math.max(1, Math.round(bounds.height)), maxHeight),
    });
  }

  public static async updateThemePreviewCss(themeId: string, code: string) {
    const view = this.themePreviewViews.get(themeId);
    if (!view || view.webContents.isDestroyed()) return;
    const css = JSON.stringify(code);
    await view.webContents.executeJavaScript(`(() => {
      const id = "theme-editor-live-preview";
      let style = document.getElementById(id);
      if (!style) {
        style = document.createElement("style");
        style.id = id;
        document.head.appendChild(style);
      }
      style.textContent = ${css};
    })()`);
  }

  private static installThemePreviewClickBridge(view: WebContentsView) {
    view.webContents.executeJavaScript(`(() => {
      // Reinstala o bridge depois de cada navegação, mas nunca instala duas
      // cópias na mesma página.
      if (window.__hydraThemeEditorBridgeInstalled) return;
      window.__hydraThemeEditorBridgeInstalled = true;

      const escape = (value) => {
        try {
          return CSS.escape(String(value));
        } catch {
          return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
        }
      };

      const unique = (items) => [...new Set(items.filter(Boolean))];

      const getElementSelector = (node) => {
        if (!(node instanceof Element)) return [];

        const result = [];

        // 1) ID é a referência mais precisa.
        if (node.id) {
          result.push("#" + escape(node.id));
        }

        // 2) Classes completas do elemento clicado.
        const classes = Array.from(node.classList || []).filter(Boolean);
        if (classes.length) {
          result.push("." + classes.map(escape).join("."));
        }

        // 3) Elementos interativos recebem prioridade.
        const tag = node.tagName.toLowerCase();
        if (["button", "a", "input", "select", "textarea", "label"].includes(tag)) {
          if (classes.length) {
            result.push(tag + "." + classes.map(escape).join("."));
          } else {
            result.push(tag);
          }
        }

        // 4) Atributos semânticos ajudam muito em ícones/botões e itens
        // que possuem classes genéricas.
        for (const attr of ["data-testid", "data-action", "data-state", "data-selected", "aria-label", "role"]) {
          const value = node.getAttribute(attr);
          if (value) {
            result.push("[" + attr + '="' + String(value).replace(/"/g, '\\"') + '"]');
          }
        }

        // 5) Seletor estrutural do elemento, preservando a posição exata.
        if (node.parentElement) {
          const siblings = Array.from(node.parentElement.children);
          const index = siblings.indexOf(node);
          if (index >= 0) {
            result.push(tag + ":nth-child(" + (index + 1) + ")");
            const sameTag = siblings.filter((child) => child.tagName === node.tagName);
            const tagIndex = sameTag.indexOf(node);
            if (tagIndex >= 0) {
              result.push(tag + ":nth-of-type(" + (tagIndex + 1) + ")");
            }
            if (classes.length) {
              result.push("." + classes.map(escape).join(".") + ":nth-child(" + (index + 1) + ")");
            }
          }
        }

        return unique(result);
      };

      const collectCandidates = (event) => {
        const candidates = [];
        const seen = new Set();

        // O elemento físico que está exatamente debaixo do cursor.
        const underPointer = document.elementsFromPoint(event.clientX, event.clientY) || [];

        // composedPath inclui SVG/path e shadow DOM quando disponível.
        const path = typeof event.composedPath === "function"
          ? event.composedPath().filter((item) => item instanceof Element)
          : [];

        const roots = unique([...underPointer, ...path, event.target instanceof Element ? event.target : null]);

        // Primeiro: elemento mais específico/interativo sob o ponteiro.
        for (const node of roots) {
          const selectors = getElementSelector(node);

          // Botões e links devem ser preferidos ao SVG/path interno.
          const tag = node.tagName.toLowerCase();
          const interactive = ["button", "a", "input", "select", "textarea", "label"].includes(tag);

          if (interactive) {
            for (const selector of selectors) {
              if (!seen.has(selector)) {
                seen.add(selector);
                candidates.push(selector);
              }
            }
          }
        }

        // Segundo: o elemento exato e seus pais, do mais específico para o
        // mais geral. Isso evita selecionar .sidebar quando o clique foi no
        // .sidebar__menu-item-button.
        for (const node of roots) {
          let current = node;
          let depth = 0;

          while (current && depth < 16) {
            for (const selector of getElementSelector(current)) {
              if (!seen.has(selector)) {
                seen.add(selector);
                candidates.push(selector);
              }
            }

            // Quando o clique foi dentro de SVG/path, subimos até BUTTON/A
            // antes de aceitar containers genéricos.
            if (current.tagName === "BUTTON" || current.tagName === "A") {
              break;
            }

            current = current.parentElement;
            depth++;
          }
        }

        // Terceiro: caminho CSS completo do ponto clicado, útil para linhas,
        // divisores e elementos que não têm classe.
        const exactNode = roots.find((node) => node instanceof Element);
        if (exactNode) {
          const chain = [];
          let current = exactNode;
          let depth = 0;

          while (current && current.parentElement && depth < 8) {
            const tag = current.tagName.toLowerCase();
            const siblings = Array.from(current.parentElement.children);
            const index = siblings.indexOf(current);
            chain.unshift(
              tag + (index >= 0 ? ":nth-child(" + (index + 1) + ")" : "")
            );
            current = current.parentElement;
            depth++;
          }

          if (chain.length) {
            const fullPath = chain.join(" > ");
            if (!seen.has(fullPath)) candidates.push(fullPath);
          }
        }

        return candidates;
      };

      const report = (event) => {
        if (!event.ctrlKey) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }

        const selectors = collectCandidates(event);

        window.electron.reportThemePreviewElementClicked(selectors);
      };

      // capture=true garante que o Ctrl+click seja interceptado antes de
      // handlers de navegação do Hydra.
      document.addEventListener("pointerdown", report, true);
      document.addEventListener("click", report, true);
    })()`);
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
        width: 1500,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        backgroundColor: "#1c1c1c",
        titleBarStyle: "hidden",
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

      const previewView = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.mjs"),
          sandbox: false,
        },
      });
      this.themePreviewViews.set(themeId, previewView);
      editorWindow.contentView.addChildView(previewView);

      const layoutPreview = () => {
        if (editorWindow.isDestroyed()) return;
        const { width, height } = editorWindow.getContentBounds();
        previewView.setBounds({
          x: 255,
          y: 100,
          width: Math.max(500, width - 610),
          height: Math.max(430, height - 180),
        });
      };
      editorWindow.on("resize", layoutPreview);
      layoutPreview();

      previewView.webContents.on("did-finish-load", () => {
        this.installThemePreviewClickBridge(previewView);
      });
      previewView.webContents.on("did-navigate", () => {
        this.installThemePreviewClickBridge(previewView);
      });
      previewView.webContents.on("did-navigate-in-page", () => {
        this.installThemePreviewClickBridge(previewView);
      });
      this.loadWindowURLForView(previewView);

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
        editorWindow.removeListener("resize", layoutPreview);
        if (!previewView.webContents.isDestroyed())
          previewView.webContents.close();
        this.themePreviewViews.delete(themeId);
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
      this.gameLauncherWindowInstance = null;
    }

    const display = screen.getPrimaryDisplay();
    const { width: displayWidth, height: displayHeight } = display.bounds;

    const x = Math.round((displayWidth - this.GAME_LAUNCHER_WINDOW_WIDTH) / 2);
    const y = Math.round(
      (displayHeight - this.GAME_LAUNCHER_WINDOW_HEIGHT) / 2
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

  public static redirectToMainWindow(hash: string) {
    this.redirect(hash);

    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      this.bigPicture.close();
      return;
    }

    this.openMainWindow();
  }

  public static redirectToGameWindow(hash: string) {
    if (this.bigPicture && !this.bigPicture.isDestroyed()) {
      this.bigPicture.webContents.send(
        "on-navigate",
        `/big-picture/${hash.replace(/^\/+/, "")}`
      );
      this.bigPicture.show();
      this.bigPicture.focus();
      return;
    }

    this.redirectToMainWindow(hash);
  }

  public static async createSystemTray(language: string) {
    let tray: Tray;

    if (process.platform === "darwin") {
      const macIcon = nativeImage
        .createFromPath(trayIcon)
        .resize({ width: 24, height: 24 });
      tray = new Tray(macIcon);
    } else if (process.platform === "win32") {
      const getWindowsTrayIcon = () =>
        nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
          ? trayIcon
          : trayIconDark;

      tray = new Tray(getWindowsTrayIcon());

      nativeTheme.on("updated", () => {
        tray.setImage(getWindowsTrayIcon());
      });
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
