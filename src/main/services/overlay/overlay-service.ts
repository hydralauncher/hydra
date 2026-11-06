import path from "node:path";
import { BrowserWindow, WebContentsView, screen, shell } from "electron";
import type {
  Game,
  OverlayBrowserState,
  OverlayGameInfo,
  OverlayHotkeyBinding,
  OverlayMode,
  OverlayPanel,
  OverlayPanelState,
  OverlayPanelStatus,
  OverlayState,
  UserPreferences,
} from "@types";
import {
  isAllowedOverlayBrowserUrl,
  normalizeOverlayBrowserUrl,
  normalizeOverlayHotkey,
  OVERLAY_BROWSER_CHROME_HEIGHT,
  OVERLAY_BROWSER_HOME_URL,
} from "@shared";

import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "../game-running-state";
import { logger } from "../logger";
import { NativeAddon } from "../native-addon";
import { ScreenshotInputService } from "../screenshot-input";
import { WindowManager } from "../window-manager";
import { resolveForegroundGame } from "../screenshots/foreground-game";

const OVERLAY_STATE_CHANNEL = "on-overlay-state";
const OVERLAY_PANEL_STATE_CHANNEL = "on-overlay-panel-state";
const OVERLAY_BROWSER_STATE_CHANNEL = "on-overlay-browser-state";
const OVERLAY_FADE_MS = 200;

export const OVERLAY_PANELS: readonly OverlayPanel[] = [
  "chat",
  "achievements",
  "leaderboard",
  "browser",
];

export const isOverlayPanel = (value: unknown): value is OverlayPanel =>
  OVERLAY_PANELS.includes(value as OverlayPanel);

type InternalOverlayState = Omit<OverlayState, "panels">;

const CLOSED_STATE: InternalOverlayState = {
  isOpen: false,
  isClosing: false,
  mode: "default",
  game: null,
};

interface PanelRuntime {
  window: BrowserWindow | null;
  loading: Promise<BrowserWindow | null> | null;
  isOpen: boolean;
  isVisible: boolean;
  isPinned: boolean;
  token: number;
  browserView: WebContentsView | null;
  browserUrl: string;
  lastBounds: Electron.Rectangle | null;
  boundsSaveTimer: NodeJS.Timeout | null;
}

const createPanelRuntime = (): PanelRuntime => ({
  window: null,
  loading: null,
  isOpen: false,
  isVisible: false,
  isPinned: false,
  token: 0,
  browserView: null,
  browserUrl: "",
  lastBounds: null,
  boundsSaveTimer: null,
});

export class OverlayService {
  private static enabled = true;
  private static browserEnabled = true;
  private static overlayHotkey: OverlayHotkeyBinding =
    normalizeOverlayHotkey(null);
  private static overlayWindow: BrowserWindow | null = null;
  private static gameWindowHandle: string | null = null;
  private static state: InternalOverlayState = { ...CLOSED_STATE };
  private static initialized = false;
  private static unsubscribeTrigger: (() => void) | null = null;
  private static unsubscribeGamesRunning: (() => void) | null = null;
  private static loadingWindow: Promise<BrowserWindow | null> | null = null;
  private static opening = false;
  private static closing = false;
  private static openToken = 0;
  private static closeTimer: NodeJS.Timeout | null = null;
  private static closePanelsOnFinish = false;
  private static browserSessionConfigured = false;
  private static panels: Record<OverlayPanel, PanelRuntime> = {
    chat: createPanelRuntime(),
    achievements: createPanelRuntime(),
    leaderboard: createPanelRuntime(),
    browser: createPanelRuntime(),
  };

  public static initialize() {
    if (this.initialized || process.platform !== "win32") return;
    this.initialized = true;

    WindowManager.registerOverlayWindowProvider(() =>
      this.achievementWindows()
    );

    this.unsubscribeTrigger?.();
    this.unsubscribeGamesRunning?.();

    this.unsubscribeTrigger = ScreenshotInputService.onOverlayTrigger(() => {
      logger.debug("Overlay hotkey triggered", { hotkey: this.overlayHotkey });
      void this.toggle();
    });
    this.unsubscribeGamesRunning = onTrackedGamesRunningChange(() => {
      if (hasTrackedGamesRunning()) {
        this.preloadPanels();
      } else {
        this.gameWindowHandle = null;
        this.close();
      }
    });

    if (hasTrackedGamesRunning()) {
      this.preloadPanels();
    }
  }

  public static syncUserPreferences(preferences: UserPreferences | null) {
    this.enabled = preferences?.overlayEnabled ?? true;
    this.browserEnabled = preferences?.overlayBrowserEnabled ?? true;
    this.overlayHotkey = normalizeOverlayHotkey(preferences?.overlayHotkey);

    if (
      !this.browserEnabled &&
      (this.panels.browser.isOpen || this.panels.browser.window)
    ) {
      this.closePanel("browser");
    }
    if (!this.enabled) this.close();
  }

  public static getState(): OverlayState {
    return { ...this.state, panels: this.getPanelStatuses() };
  }

  public static getPanelState(panel: OverlayPanel): OverlayPanelState {
    if (!isOverlayPanel(panel)) {
      throw new Error(`Unknown overlay panel: ${String(panel)}`);
    }

    const runtime = this.panels[panel];

    return {
      panel,
      isOpen: runtime.isOpen,
      isVisible: runtime.isVisible,
      isWarm: Boolean(runtime.window && !runtime.window.isDestroyed()),
      isPinned: runtime.isPinned,
      isOverlayOpen: this.state.isOpen && !this.state.isClosing,
      isOverlayClosing: this.state.isClosing,
    };
  }

  public static async toggle() {
    if (
      process.platform !== "win32" ||
      !this.enabled ||
      this.opening ||
      this.closing
    ) {
      return;
    }

    if (this.state.isOpen) {
      this.close();
      return;
    }

    if (!hasTrackedGamesRunning()) return;

    const token = ++this.openToken;
    this.opening = true;

    try {
      const resolved = await resolveForegroundGame("overlay");
      if (
        token !== this.openToken ||
        !this.enabled ||
        this.state.isOpen ||
        !hasTrackedGamesRunning()
      ) {
        return;
      }

      if (resolved.status !== "resolved" || !resolved.game) {
        const lastGame = this.state.game;
        const canReuseLastGame =
          Boolean(lastGame) &&
          (this.hasVisiblePanels() ||
            this.isOwnOverlayForeground(resolved.foreground?.processId));

        if (canReuseLastGame && lastGame) {
          const overlayWindow = await this.ensureWindow();
          if (
            token !== this.openToken ||
            !this.enabled ||
            this.state.isOpen ||
            !hasTrackedGamesRunning() ||
            !overlayWindow ||
            overlayWindow.isDestroyed()
          ) {
            return;
          }

          this.openWindow(
            overlayWindow,
            overlayWindow.getBounds(),
            lastGame,
            WindowManager.isBigPictureOpen() ? "bigPicture" : "default"
          );
        }
        return;
      }

      const windowHandle = resolved.foreground?.windowHandle;
      if (!windowHandle) return;
      this.gameWindowHandle = windowHandle;

      const bounds = NativeAddon.getWindowsWindowBounds(windowHandle);
      if (!bounds) return;

      const { left, top, right, bottom } = bounds.client;
      const width = Math.round(right - left);
      const height = Math.round(bottom - top);
      if (width <= 0 || height <= 0) return;

      const overlayWindow = await this.ensureWindow();
      if (
        token !== this.openToken ||
        !this.enabled ||
        this.state.isOpen ||
        !hasTrackedGamesRunning() ||
        !overlayWindow ||
        overlayWindow.isDestroyed()
      ) {
        return;
      }

      const rect = screen.screenToDipRect(null, {
        x: Math.round(left),
        y: Math.round(top),
        width,
        height,
      });

      this.openWindow(
        overlayWindow,
        rect,
        this.toGameInfo(resolved.game, resolved.target.gameKey),
        WindowManager.isBigPictureOpen() ? "bigPicture" : "default"
      );
    } finally {
      if (token === this.openToken) this.opening = false;
    }
  }

  public static close() {
    this.openToken += 1;
    this.opening = false;

    if (this.closing) {
      if (!this.enabled || !hasTrackedGamesRunning()) {
        this.closePanelsOnFinish = true;
      }
      return;
    }

    if (!this.state.isOpen) {
      if (!this.enabled || !hasTrackedGamesRunning()) {
        this.closeAllPanels();
        this.state = { ...this.state, game: null };
        this.broadcastState();
      }
      return;
    }

    this.closing = true;
    this.closePanelsOnFinish = !this.enabled || !hasTrackedGamesRunning();
    this.state = { ...this.state, isClosing: true };
    this.broadcastState();
    this.broadcastPanelStates();

    this.closeTimer = setTimeout(() => this.finishClose(), OVERLAY_FADE_MS);
  }

  public static openPanel(panel: OverlayPanel) {
    if (!isOverlayPanel(panel)) return;
    if (!this.state.isOpen || this.state.isClosing) return;
    if (panel === "browser" && !this.browserEnabled) return;
    if (this.state.mode === "bigPicture" && panel !== "browser") return;

    const runtime = this.panels[panel];
    if (runtime.isOpen) {
      this.hidePanel(panel, true);
      return;
    }

    void this.showPanel(panel, true);
  }

  public static closePanel(panel: OverlayPanel) {
    if (!isOverlayPanel(panel)) return;
    this.hidePanel(panel, true);
  }

  public static setPanelPinned(panel: OverlayPanel, pinned: boolean) {
    if (!isOverlayPanel(panel)) return;

    const runtime = this.panels[panel];
    runtime.isPinned = pinned;

    if (!pinned && !this.state.isOpen) {
      this.hidePanel(panel, true);
      return;
    }

    this.broadcastState();
    this.sendPanelState(panel);
  }

  public static getBrowserState(): OverlayBrowserState {
    const runtime = this.panels.browser;
    const webContents = this.browserWebContents();

    if (!webContents) {
      return {
        url: runtime.browserUrl,
        title: "",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
      };
    }

    return {
      url: webContents.getURL() || runtime.browserUrl,
      title: webContents.getTitle(),
      isLoading: webContents.isLoading(),
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
    };
  }

  public static navigateBrowser(url: string) {
    if (!this.browserEnabled) return;

    const normalized = normalizeOverlayBrowserUrl(url);
    if (!normalized) return;

    this.panels.browser.browserUrl = normalized;
    this.ensureBrowserView("browser");

    const webContents = this.browserWebContents();
    if (webContents) void webContents.loadURL(normalized);
  }

  public static browserGoBack() {
    const webContents = this.browserWebContents();
    if (webContents?.navigationHistory.canGoBack()) {
      webContents.navigationHistory.goBack();
    }
  }

  public static browserGoForward() {
    const webContents = this.browserWebContents();
    if (webContents?.navigationHistory.canGoForward()) {
      webContents.navigationHistory.goForward();
    }
  }

  public static browserReload() {
    this.browserWebContents()?.reload();
  }

  public static browserHome() {
    this.navigateBrowser(OVERLAY_BROWSER_HOME_URL);
  }

  private static browserWebContents() {
    const view = this.panels.browser.browserView;
    if (!view || view.webContents.isDestroyed()) return null;
    return view.webContents;
  }

  private static ensureBrowserView(panel: OverlayPanel) {
    const runtime = this.panels[panel];
    const panelWindow = runtime.window;

    if (runtime.browserView) {
      if (!runtime.browserView.webContents.isDestroyed()) return;

      if (panelWindow && !panelWindow.isDestroyed()) {
        try {
          panelWindow.contentView.removeChildView(runtime.browserView);
        } catch {
          // The view may already be detached.
        }
      }
      runtime.browserView = null;
    }

    if (!panelWindow || panelWindow.isDestroyed()) return;

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        partition: "persist:overlay-browser",
      },
    });

    const webContents = view.webContents;

    if (!this.browserSessionConfigured) {
      webContents.session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false)
      );
      webContents.session.on("will-download", (event) => {
        event.preventDefault();
      });
      this.browserSessionConfigured = true;
    }

    webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedOverlayBrowserUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });

    const blockUnsupportedNavigation = (event: Electron.Event, url: string) => {
      if (!isAllowedOverlayBrowserUrl(url)) event.preventDefault();
    };

    webContents.on("will-navigate", blockUnsupportedNavigation);
    webContents.on("will-redirect", blockUnsupportedNavigation);

    const notify = () => this.sendBrowserState(panel);
    webContents.on("did-navigate", notify);
    webContents.on("did-navigate-in-page", notify);
    webContents.on("page-title-updated", notify);
    webContents.on("did-start-loading", notify);
    webContents.on("did-stop-loading", notify);
    webContents.on("render-process-gone", () => {
      this.destroyBrowserView(panel);
    });

    panelWindow.contentView.addChildView(view);
    runtime.browserView = view;
    this.updateBrowserViewBounds(panel);

    const target = runtime.browserUrl || OVERLAY_BROWSER_HOME_URL;
    runtime.browserUrl = target;
    void webContents.loadURL(target);

    this.sendBrowserState(panel);
  }

  private static destroyBrowserView(panel: OverlayPanel) {
    const runtime = this.panels[panel];
    const view = runtime.browserView;
    if (!view) return;

    runtime.browserView = null;

    try {
      const url = view.webContents.getURL();
      if (url) runtime.browserUrl = url;
    } catch {
      // The web contents may already be gone.
    }

    const panelWindow = runtime.window;
    if (panelWindow && !panelWindow.isDestroyed()) {
      try {
        panelWindow.contentView.removeChildView(view);
      } catch {
        // The view may already be detached.
      }
    }

    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.sendBrowserState(panel);
  }

  private static updateBrowserViewBounds(panel: OverlayPanel) {
    const runtime = this.panels[panel];
    const view = runtime.browserView;
    const panelWindow = runtime.window;

    if (!view || !panelWindow || panelWindow.isDestroyed()) return;

    const { width, height } = panelWindow.getContentBounds();
    view.setBounds({
      x: 1,
      y: OVERLAY_BROWSER_CHROME_HEIGHT,
      width: Math.max(0, width - 2),
      height: Math.max(0, height - OVERLAY_BROWSER_CHROME_HEIGHT - 1),
    });
  }

  private static sendBrowserState(panel: OverlayPanel) {
    const panelWindow = this.panels[panel].window;
    if (!panelWindow || panelWindow.isDestroyed()) return;

    panelWindow.webContents.send(
      OVERLAY_BROWSER_STATE_CHANNEL,
      this.getBrowserState()
    );
  }

  private static finishClose() {
    this.closeTimer = null;
    this.closing = false;

    const overlayWindow = this.overlayWindow;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }

    if (this.closePanelsOnFinish) {
      this.closeAllPanels();
      this.state = {
        ...this.state,
        isOpen: false,
        isClosing: false,
        game: null,
      };
    } else {
      for (const panel of OVERLAY_PANELS) {
        const runtime = this.panels[panel];
        if (runtime.isPinned) continue;

        runtime.isVisible = false;
        this.capturePanelBounds(panel);
        runtime.window?.hide();
        if (panel === "browser") this.destroyBrowserView(panel);
      }
      this.state = { ...this.state, isOpen: false, isClosing: false };
      this.broadcastPanelStates();
    }

    this.closePanelsOnFinish = false;
    this.broadcastState();
    this.restoreGameFocus();
  }

  private static openWindow(
    overlayWindow: BrowserWindow,
    rect: Electron.Rectangle,
    game: OverlayGameInfo,
    mode: OverlayMode
  ) {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.closing = false;

    overlayWindow.setBounds(rect);
    this.state = {
      isOpen: true,
      isClosing: false,
      mode,
      game,
    };
    this.broadcastState();
    this.broadcastPanelStates();
    overlayWindow.show();
    overlayWindow.focus();

    if (mode === "bigPicture") {
      this.closeAllPanels();
    } else {
      this.preloadPanels();
      this.restoreOpenPanels();
    }
  }

  private static restoreOpenPanels() {
    let focused = false;

    for (const panel of OVERLAY_PANELS) {
      if (this.panels[panel].isOpen) {
        void this.showPanel(panel, !focused);
        focused = true;
      }
    }

    this.raiseVisiblePanels();
  }

  private static restoreGameFocus() {
    const windowHandle = this.gameWindowHandle;
    if (!windowHandle) return;

    if (!hasTrackedGamesRunning()) {
      this.gameWindowHandle = null;
      return;
    }

    if (!NativeAddon.focusWindowsWindow(windowHandle)) {
      logger.debug("Failed to restore focus to the game window", {
        windowHandle,
      });
    }
  }

  private static async showPanel(panel: OverlayPanel, focus: boolean) {
    const runtime = this.panels[panel];
    const wasOpen = runtime.isOpen;
    const wasVisible = runtime.isVisible;
    const token = ++runtime.token;

    runtime.isOpen = true;
    runtime.isVisible = true;
    this.broadcastState();

    const panelWindow = await this.ensurePanelWindow(panel);

    if (token !== runtime.token) return;

    if (
      !panelWindow ||
      panelWindow.isDestroyed() ||
      !this.state.isOpen ||
      this.state.isClosing ||
      (this.state.mode === "bigPicture" && panel !== "browser")
    ) {
      runtime.isOpen = wasOpen;
      runtime.isVisible = wasVisible;
      this.broadcastState();
      this.sendPanelState(panel);
      return;
    }

    if (!wasVisible) {
      const target =
        runtime.lastBounds && this.isBoundsVisible(runtime.lastBounds)
          ? runtime.lastBounds
          : this.getPanelBounds(panel);

      panelWindow.setBounds(target);
      runtime.lastBounds = target;
    }

    if (panel === "browser") {
      this.ensureBrowserView(panel);
    }

    if (focus) {
      panelWindow.show();
      panelWindow.focus();
    } else {
      panelWindow.showInactive();
      panelWindow.moveTop();
    }

    this.sendPanelState(panel);
  }

  private static capturePanelBounds(panel: OverlayPanel) {
    const runtime = this.panels[panel];
    const panelWindow = runtime.window;

    if (panelWindow && !panelWindow.isDestroyed()) {
      runtime.lastBounds = panelWindow.getBounds();
    }
  }

  private static hidePanel(panel: OverlayPanel, reset: boolean) {
    const runtime = this.panels[panel];

    this.capturePanelBounds(panel);
    runtime.token += 1;
    runtime.isVisible = false;
    runtime.window?.hide();

    if (panel === "browser") {
      this.destroyBrowserView(panel);
      if (
        !this.browserEnabled &&
        runtime.window &&
        !runtime.window.isDestroyed()
      ) {
        runtime.window.destroy();
      }
    }

    if (reset) {
      runtime.isOpen = false;
      runtime.isPinned = false;
    }

    this.broadcastState();
    this.sendPanelState(panel);

    if (!this.state.isOpen) {
      this.restoreGameFocus();
    }
  }

  private static closeAllPanels() {
    for (const panel of OVERLAY_PANELS) {
      const runtime = this.panels[panel];
      runtime.token += 1;
      runtime.isOpen = false;
      runtime.isVisible = false;
      runtime.isPinned = false;
      this.capturePanelBounds(panel);
      if (runtime.boundsSaveTimer) {
        clearTimeout(runtime.boundsSaveTimer);
        runtime.boundsSaveTimer = null;
      }
      runtime.window?.hide();
      if (panel === "browser") this.destroyBrowserView(panel);
      if (runtime.window && !runtime.window.isDestroyed()) {
        runtime.window.destroy();
      }
      this.sendPanelState(panel);
    }
  }

  private static getPanelStatuses(): OverlayPanelStatus[] {
    return OVERLAY_PANELS.map((panel) => {
      const runtime = this.panels[panel];
      return {
        panel,
        isOpen: runtime.isOpen,
        isPinned: runtime.isPinned,
      };
    });
  }

  private static broadcastState() {
    const state = this.getState();

    for (const window of [this.overlayWindow, ...this.panelWindows()]) {
      if (!window || window.isDestroyed()) continue;
      window.webContents.send(OVERLAY_STATE_CHANNEL, state);
    }
  }

  private static broadcastPanelStates() {
    for (const panel of OVERLAY_PANELS) {
      this.sendPanelState(panel);
    }
  }

  private static sendPanelState(panel: OverlayPanel) {
    const panelWindow = this.panels[panel].window;
    if (!panelWindow || panelWindow.isDestroyed()) return;

    panelWindow.webContents.send(
      OVERLAY_PANEL_STATE_CHANNEL,
      this.getPanelState(panel)
    );
  }

  private static achievementWindows() {
    const achievementsPanel = this.panels.achievements;
    return [
      this.state.isOpen && this.state.mode === "bigPicture"
        ? this.overlayWindow
        : null,
      achievementsPanel.isVisible ? achievementsPanel.window : null,
    ];
  }

  private static raiseVisiblePanels() {
    for (const panel of OVERLAY_PANELS) {
      const runtime = this.panels[panel];
      if (
        runtime.isVisible &&
        runtime.window &&
        !runtime.window.isDestroyed()
      ) {
        runtime.window.setAlwaysOnTop(true, "screen-saver");
        runtime.window.moveTop();
      }
    }
  }

  private static panelWindows() {
    return OVERLAY_PANELS.map((panel) => this.panels[panel].window);
  }

  private static hasVisiblePanels() {
    return OVERLAY_PANELS.some((panel) => this.panels[panel].isVisible);
  }

  private static isOwnOverlayForeground(processId: number | null | undefined) {
    if (!processId) return false;

    const windows = [this.overlayWindow, ...this.panelWindows()];
    return windows.some((window) => {
      return (
        window &&
        !window.isDestroyed() &&
        window.webContents.getOSProcessId() === processId
      );
    });
  }

  private static preloadPanels() {
    if (!this.enabled || WindowManager.isBigPictureOpen()) return;

    const panels = OVERLAY_PANELS.filter(
      (panel) => panel !== "browser" || this.browserEnabled
    );

    panels.forEach((panel, index) => {
      setTimeout(() => {
        if (!this.enabled || !hasTrackedGamesRunning()) return;
        void this.ensurePanelWindow(panel);
      }, index * 400);
    });
  }

  private static isBoundsVisible(bounds: Electron.Rectangle) {
    return screen.getAllDisplays().some(({ workArea }) => {
      return (
        bounds.x < workArea.x + workArea.width &&
        bounds.x + bounds.width > workArea.x &&
        bounds.y < workArea.y + workArea.height &&
        bounds.y + bounds.height > workArea.y
      );
    });
  }

  private static getPanelBounds(panel: OverlayPanel): Electron.Rectangle {
    const margin = 24;
    const fallback = screen.getPrimaryDisplay().workArea;
    const bounds = this.overlayWindow?.getBounds() ?? fallback;
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;

    if (panel === "chat") {
      const width = Math.min(560, Math.max(320, workArea.width - margin * 2));
      const height = Math.min(680, Math.max(360, workArea.height - margin * 2));
      const x = Math.min(
        Math.max(bounds.x + bounds.width - width - margin, workArea.x + margin),
        workArea.x + workArea.width - width - margin
      );
      const y = Math.min(
        Math.max(bounds.y + margin, workArea.y + margin),
        workArea.y + workArea.height - height - margin
      );

      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
    }

    if (panel === "browser") {
      const width = Math.min(1000, Math.max(640, workArea.width - margin * 2));
      const height = Math.min(760, Math.max(400, workArea.height - margin * 2));
      const x = Math.min(
        Math.max(bounds.x + (bounds.width - width) / 2, workArea.x + margin),
        workArea.x + workArea.width - width - margin
      );
      const y = Math.min(
        Math.max(bounds.y + margin, workArea.y + margin),
        workArea.y + workArea.height - height - margin
      );

      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
    }

    const width = Math.min(760, Math.max(480, workArea.width - margin * 4));
    const height = Math.min(680, Math.max(360, workArea.height - margin * 2));
    const x = Math.min(
      Math.max(bounds.x + (bounds.width - width) / 2, workArea.x + margin),
      workArea.x + workArea.width - width - margin
    );
    const y = Math.min(
      Math.max(bounds.y + margin, workArea.y + margin),
      workArea.y + workArea.height - height - margin
    );

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  private static toGameInfo(game: Game, gameKey: string): OverlayGameInfo {
    return {
      gameKey,
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      iconUrl: game.customIconUrl ?? game.iconUrl,
      achievementCount: game.achievementCount,
    };
  }

  private static ensureWindow(): Promise<BrowserWindow | null> {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return Promise.resolve(this.overlayWindow);
    }
    if (this.loadingWindow) return this.loadingWindow;

    this.loadingWindow = this.createWindow().finally(() => {
      this.loadingWindow = null;
    });

    return this.loadingWindow;
  }

  private static ensurePanelWindow(
    panel: OverlayPanel
  ): Promise<BrowserWindow | null> {
    const runtime = this.panels[panel];
    if (runtime.window && !runtime.window.isDestroyed()) {
      return Promise.resolve(runtime.window);
    }
    if (runtime.loading) return runtime.loading;

    runtime.loading = this.createPanelWindow(panel).finally(() => {
      runtime.loading = null;
    });

    return runtime.loading;
  }

  private static async createWindow(): Promise<BrowserWindow | null> {
    try {
      const overlayWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        show: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        focusable: true,
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.mjs"),
          sandbox: false,
        },
      });

      overlayWindow.setAlwaysOnTop(true, "screen-saver");
      overlayWindow.on("focus", () => {
        this.raiseVisiblePanels();
        setTimeout(() => this.raiseVisiblePanels(), 50);
      });
      overlayWindow.on("closed", () => {
        if (this.overlayWindow === overlayWindow) {
          if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
          }
          this.closing = false;
          this.overlayWindow = null;
          this.state = { ...CLOSED_STATE };
          this.closeAllPanels();
        }
      });

      this.overlayWindow = overlayWindow;
      await WindowManager.loadWindowURL(overlayWindow, "overlay");

      return overlayWindow;
    } catch (error) {
      logger.error("Failed to create the in-game overlay window", error);
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.destroy();
      }
      this.overlayWindow = null;
      return null;
    }
  }

  private static async createPanelWindow(
    panel: OverlayPanel
  ): Promise<BrowserWindow | null> {
    const runtime = this.panels[panel];

    try {
      const panelWindow = new BrowserWindow({
        width: panel === "browser" ? 1000 : panel === "chat" ? 560 : 760,
        height: panel === "browser" ? 760 : 680,
        minWidth: panel === "browser" ? 640 : panel === "chat" ? 400 : 520,
        minHeight: panel === "browser" ? 400 : 280,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        show: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        focusable: true,
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.mjs"),
          sandbox: false,
        },
      });

      panelWindow.setAlwaysOnTop(true, "screen-saver");
      panelWindow.removeMenu();

      const saveBounds = () => {
        if (runtime.boundsSaveTimer) {
          clearTimeout(runtime.boundsSaveTimer);
        }

        runtime.boundsSaveTimer = setTimeout(() => {
          runtime.boundsSaveTimer = null;
          if (!panelWindow.isDestroyed()) {
            runtime.lastBounds = panelWindow.getBounds();
          }
        }, 150);
      };

      panelWindow.on("move", saveBounds);
      panelWindow.on("resize", () => {
        saveBounds();
        if (panel === "browser") this.updateBrowserViewBounds(panel);
      });

      panelWindow.on("closed", () => {
        if (runtime.boundsSaveTimer) {
          clearTimeout(runtime.boundsSaveTimer);
          runtime.boundsSaveTimer = null;
        }
        if (runtime.window !== panelWindow) return;
        runtime.token += 1;
        if (panel === "browser") this.destroyBrowserView(panel);
        runtime.window = null;
        runtime.isOpen = false;
        runtime.isVisible = false;
        runtime.isPinned = false;
        this.broadcastState();
      });

      runtime.window = panelWindow;
      await WindowManager.loadWindowURL(panelWindow, `overlay/${panel}`);

      if (!this.enabled || !hasTrackedGamesRunning()) {
        if (!panelWindow.isDestroyed()) panelWindow.destroy();
        runtime.window = null;
        return null;
      }

      return panelWindow;
    } catch (error) {
      logger.error("Failed to create an in-game overlay panel", {
        panel,
        error,
      });
      if (runtime.window && !runtime.window.isDestroyed()) {
        runtime.window.destroy();
      }
      runtime.window = null;
      return null;
    }
  }
}
