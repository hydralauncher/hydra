import { isStaging } from "@main/constants";
import { db, levelKeys } from "@main/level";
import type {
  Game,
  HydraOverlayContext,
  HydraOverlayGamepadAction,
  HydraOverlayPerformance,
  User,
  UserPreferences,
} from "@types";
import {
  DEFAULT_HYDRA_OVERLAY_PREFERENCES,
  resolveHydraOverlayPreferences,
} from "@shared";
import { BrowserWindow, app, globalShortcut, screen } from "electron";
import path from "node:path";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { getGameAssets } from "@main/events/catalogue/get-game-assets";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import { findOverlayGameProcesses } from "./overlay-game-process";
import { overlayFpsMonitor } from "./overlay-fps-monitor";
import { ensureOverlayInputBroker } from "./overlay-input-broker";
import { boundsFillDisplay } from "./overlay-window-behavior";
import { WindowManager } from "./window-manager";

const PREFERRED_SHORTCUT = "Shift+Tab";
const CONTROLLER_SHORTCUT = "View + Menu";
const TOAST_WIDTH = 620;
const TOAST_HEIGHT = 190;
const TOAST_MARGIN = 24;
const FPS_WIDTH = 218;
const FPS_HEIGHT = 116;
const TOGGLE_DEBOUNCE_MS = 350;
const GAMEPAD_REPEAT_DELAY_MS = 360;
const GAMEPAD_REPEAT_INTERVAL_MS = 105;
const OVERLAY_FADE_DURATION_MS = 140;

const GAMEPAD_ACTIONS: Array<[number, HydraOverlayGamepadAction]> = [
  [0x1000, "accept"],
  [0x2000, "back"],
  [0x0100, "previous-tab"],
  [0x0200, "next-tab"],
  [0x0001, "up"],
  [0x0002, "down"],
  [0x0004, "left"],
  [0x0008, "right"],
];
const GAMEPAD_DIRECTION_MASK = 0x000f;
const GAMEPAD_OVERLAY_CHORD = 0x0030;

const emptyPerformance = (): HydraOverlayPerformance => ({
  fps: null,
  averageFps: null,
  onePercentLow: null,
  frameTimeMs: null,
  updatedAt: Date.now(),
});

export class OverlayManager {
  private static overlayWindow: BrowserWindow | null = null;
  private static toastWindow: BrowserWindow | null = null;
  private static fpsWindow: BrowserWindow | null = null;
  private static activeGame: Game | null = null;
  private static servicesActive = false;
  private static sessionStartedAt = 0;
  private static registeredShortcut: string | null = null;
  private static registeredWithElectron = false;
  private static controllerPoll: NodeJS.Timeout | null = null;
  private static wasControllerChordPressed = false;
  private static previousGamepadButtons = 0;
  private static repeatingGamepadButton = 0;
  private static nextGamepadRepeatAt = 0;
  private static keyboardEventCount = 0;
  private static performancePinned = false;
  private static performance = emptyPerformance();
  private static preferences = DEFAULT_HYDRA_OVERLAY_PREFERENCES;
  private static lastToggleAt = 0;
  private static targetPid = 0;
  private static targetPoll: NodeJS.Timeout | null = null;
  private static targetRefreshPending = false;
  private static lastTargetRefreshAt = 0;
  private static fadeTimer: NodeJS.Timeout | null = null;
  private static toastTimer: NodeJS.Timeout | null = null;
  private static linuxToastActive = false;
  private static toastSequence = 0;

  public static initialize() {
    overlayFpsMonitor.setUpdateHandler((metrics) =>
      this.updatePerformance(metrics)
    );
    app.once("will-quit", () => this.dispose());
  }

  public static setActiveGame(game: Game) {
    if (
      this.activeGame?.objectId === game.objectId &&
      this.activeGame.shop === game.shop
    ) {
      return;
    }

    this.stopActiveServices();
    this.activeGame = game;
    this.sessionStartedAt = Date.now();
    this.performancePinned = false;
    void this.configureActiveGame(game);
  }

  public static applyUserPreferences(preferences: UserPreferences) {
    const wasOverlayEnabled = this.preferences.overlayEnabled;
    const wasPerformanceEnabled = this.preferences.overlayPerformanceEnabled;
    this.readPreferences(preferences);

    const game = this.activeGame;
    if (!game) return;
    if (!this.preferences.overlayEnabled) {
      this.stopActiveServices();
      return;
    }
    if (!wasOverlayEnabled || !this.servicesActive) {
      this.startActiveServices(game);
      return;
    }
    if (
      process.platform !== "linux" &&
      this.preferences.overlayPerformanceEnabled !== wasPerformanceEnabled
    ) {
      this.performancePinned = false;
      this.destroyFpsWindow();
      if (this.preferences.overlayPerformanceEnabled) {
        void overlayFpsMonitor.start(game);
      } else {
        overlayFpsMonitor.stop();
      }
    }
    this.notifyOverlayContextChanged();
  }

  private static async configureActiveGame(game: Game) {
    const preferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (
      this.activeGame?.objectId !== game.objectId ||
      this.activeGame.shop !== game.shop
    ) {
      return;
    }
    this.readPreferences(preferences);
    if (this.preferences.overlayEnabled) this.startActiveServices(game);
  }

  private static startActiveServices(game: Game) {
    if (this.servicesActive || !this.preferences.overlayEnabled) return;
    this.servicesActive = true;
    const nativeKeyboardActive = this.startControllerPolling();
    this.registerShortcut(nativeKeyboardActive);
    if (process.platform === "win32") {
      void ensureOverlayInputBroker().then((ready) => {
        if (!this.servicesActive) return;
        if (ready) NativeAddon.startOverlayInputBroker();
        if (this.preferences.overlayPerformanceEnabled) {
          void overlayFpsMonitor.start(game);
        }
      });
    }
    this.startTargetPolling();
    void this.refreshTargetProcess(game).then(() => {
      if (
        this.servicesActive &&
        this.activeGame?.objectId === game.objectId &&
        this.activeGame.shop === game.shop
      ) {
        this.showActivationToast();
      }
    });
  }

  public static getActiveGame() {
    return this.activeGame;
  }

  public static getTargetProcessId() {
    return this.targetPid;
  }

  public static clearActiveGame(game: Game) {
    if (
      this.activeGame?.objectId !== game.objectId ||
      this.activeGame?.shop !== game.shop
    ) {
      return;
    }

    this.activeGame = null;
    this.sessionStartedAt = 0;
    this.stopActiveServices();
  }

  public static async getContext(): Promise<HydraOverlayContext | null> {
    const game = this.activeGame;
    if (!game) return null;

    const [user, achievements, assets] = await Promise.all([
      db
        .get<string, User>(levelKeys.user, { valueEncoding: "json" })
        .catch(() => null),
      getUnlockedAchievements(game.objectId, game.shop, true).catch(() => []),
      getGameAssets(game.objectId, game.shop).catch(() => null),
    ]);

    return {
      game: {
        title: game.title,
        objectId: game.objectId,
        shop: game.shop,
        iconUrl: game.customIconUrl ?? assets?.iconUrl ?? game.iconUrl,
        logoImageUrl:
          game.customLogoImageUrl ??
          assets?.logoImageUrl ??
          game.logoImageUrl ??
          (game.shop === "steam"
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/logo_2x.png`
            : null),
        heroImageUrl:
          game.customHeroImageUrl ??
          assets?.libraryHeroImageUrl ??
          game.libraryHeroImageUrl,
        coverImageUrl:
          game.customCoverImageUrl ?? assets?.coverImageUrl ?? null,
        playTimeInMilliseconds: game.playTimeInMilliseconds ?? 0,
        sessionStartedAt: this.sessionStartedAt,
      },
      user: user
        ? {
            displayName: user.displayName,
            profileImageUrl: user.profileImageUrl,
          }
        : null,
      achievements,
      shortcut: this.registeredShortcut ?? PREFERRED_SHORTCUT,
      controllerShortcut: CONTROLLER_SHORTCUT,
      performance: this.performance,
      performancePinned: this.performancePinned,
      settings: {
        performanceEnabled:
          process.platform !== "linux" &&
          this.preferences.overlayPerformanceEnabled,
        performanceRows: {
          fps: this.preferences.overlayPerformanceShowFps,
          averageFps: this.preferences.overlayPerformanceShowAverageFps,
          frameTime: this.preferences.overlayPerformanceShowFrameTime,
          onePercentLow: this.preferences.overlayPerformanceShowOnePercentLow,
        },
      },
    };
  }

  public static toggleOverlay() {
    if (!this.activeGame || !this.servicesActive) return;

    const now = Date.now();
    if (now - this.lastToggleAt < TOGGLE_DEBOUNCE_MS) return;
    this.lastToggleAt = now;

    void this.toggleOverlayWindow();
  }

  private static async toggleOverlayWindow() {
    const game = this.activeGame;
    if (!game) return;
    await this.refreshTargetProcess(game);
    if (
      this.activeGame?.objectId !== game.objectId ||
      this.activeGame?.shop !== game.shop
    ) {
      return;
    }
    const overlayWindow = this.ensureOverlayWindow();
    if (overlayWindow.isVisible()) {
      this.hideOverlay();
      return;
    }

    const show = () => {
      if (overlayWindow.isDestroyed() || !this.activeGame) return;
      const preserveGameFocus = this.shouldPreserveGameFocus();
      this.linuxToastActive = false;
      this.clearToastTimer();
      this.fpsWindow?.hide();
      this.setOverlayBounds(overlayWindow);
      overlayWindow.setAlwaysOnTop(false);
      overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
      overlayWindow.setOpacity(0);
      overlayWindow.webContents.send("on-overlay-mode", "full");
      if (preserveGameFocus) overlayWindow.showInactive();
      else overlayWindow.show();
      this.placeWindowOverGame(overlayWindow);
      overlayWindow.moveTop();
      if (!preserveGameFocus) overlayWindow.focus();
      this.fadeOverlayWindow(1);
      overlayWindow.webContents.send("on-overlay-shown");
      setTimeout(() => {
        if (!overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
          overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
          this.placeWindowOverGame(overlayWindow);
          overlayWindow.moveTop();
          if (!preserveGameFocus) overlayWindow.focus();
        }
      }, 75);
    };

    if (overlayWindow.webContents.isLoadingMainFrame()) {
      overlayWindow.webContents.once("did-finish-load", show);
    } else {
      show();
    }
  }

  public static hideOverlay() {
    this.linuxToastActive = false;
    this.clearToastTimer();
    const overlayWindow = this.overlayWindow;
    const finish = () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
        overlayWindow.setOpacity(1);
      }
      if (this.activeGame && this.performancePinned) this.showFpsWindow();
      const pid = this.targetPid;
      if (pid) setTimeout(() => NativeAddon.focusProcessWindow(pid), 25);
    };
    if (
      overlayWindow &&
      !overlayWindow.isDestroyed() &&
      overlayWindow.isVisible()
    ) {
      this.fadeOverlayWindow(0, finish);
    } else {
      finish();
    }
  }

  private static fadeOverlayWindow(opacity: number, onComplete?: () => void) {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    const window = this.overlayWindow;
    if (!window || window.isDestroyed()) {
      onComplete?.();
      return;
    }

    const startedAt = Date.now();
    const initialOpacity = opacity === 1 ? 0 : 1;
    const tick = () => {
      if (window.isDestroyed()) {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        onComplete?.();
        return;
      }
      const progress = Math.min(
        1,
        (Date.now() - startedAt) / OVERLAY_FADE_DURATION_MS
      );
      window.setOpacity(initialOpacity + (opacity - initialOpacity) * progress);
      if (progress < 1) return;
      if (this.fadeTimer) clearInterval(this.fadeTimer);
      this.fadeTimer = null;
      onComplete?.();
    };
    tick();
    if (this.fadeTimer === null) this.fadeTimer = setInterval(tick, 16);
  }

  public static setPerformancePinned(pinned: boolean) {
    if (
      process.platform === "linux" ||
      !this.preferences.overlayPerformanceEnabled
    ) {
      return;
    }
    this.performancePinned = pinned;
    this.overlayWindow?.webContents.send("on-overlay-performance-pin", pinned);
    if (!pinned) {
      this.destroyFpsWindow();
    } else if (!this.overlayWindow?.isVisible()) {
      this.showFpsWindow();
    }
  }

  private static ensureOverlayWindow() {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return this.overlayWindow;
    }

    const bounds = this.getTargetBounds();
    const overlayWindow = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: process.platform === "linux",
      fullscreen: process.platform === "linux",
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    overlayWindow.removeMenu();
    overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
    if (process.platform === "linux") {
      overlayWindow.setVisibleOnAllWorkspaces(true);
      overlayWindow.setFullScreen(true);
      NativeAddon.markGamescopeOverlay(
        overlayWindow.getNativeWindowHandle(),
        false
      );
    }
    WindowManager.loadWindowURL(overlayWindow, "overlay");

    if ((!app.isPackaged || isStaging) && process.env.HYDRA_OVERLAY_DEVTOOLS) {
      overlayWindow.webContents.openDevTools({ mode: "detach" });
    }

    overlayWindow.on("closed", () => {
      this.overlayWindow = null;
    });

    this.overlayWindow = overlayWindow;
    return overlayWindow;
  }

  private static async refreshTargetProcess(game: Game) {
    if (this.targetRefreshPending) return this.targetPid;
    this.targetRefreshPending = true;
    try {
      const candidates = await findOverlayGameProcesses(game);
      if (
        this.activeGame?.objectId !== game.objectId ||
        this.activeGame.shop !== game.shop
      ) {
        return this.targetPid;
      }
      this.targetPid = candidates[0]?.pid ?? 0;
      this.lastTargetRefreshAt = Date.now();
      return this.targetPid;
    } finally {
      this.targetRefreshPending = false;
    }
  }

  private static getTargetBounds(): Electron.Rectangle {
    if (process.platform === "linux") return screen.getPrimaryDisplay().bounds;
    if (this.targetPid) {
      const bounds = NativeAddon.getProcessWindowBounds(this.targetPid);
      if (bounds && bounds.width > 0 && bounds.height > 0) return bounds;
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  }

  private static shouldPreserveGameFocus() {
    if (process.platform !== "win32" || !this.targetPid) return false;
    if (NativeAddon.getForegroundProcessId() !== this.targetPid) return false;
    const targetBounds = this.getTargetBounds();
    const displayBounds = screen.getDisplayMatching(targetBounds).bounds;
    return boundsFillDisplay(targetBounds, displayBounds);
  }

  private static placeWindowOverGame(window: BrowserWindow) {
    if (window.isDestroyed()) return;
    if (process.platform === "linux") {
      this.setOverlayBounds(window);
      return;
    }
    if (
      process.platform === "win32" &&
      this.targetPid &&
      NativeAddon.placeOverlayWindow(
        window.getNativeWindowHandle(),
        this.targetPid
      )
    ) {
      return;
    }
    window.setBounds(this.getTargetBounds());
  }

  private static setOverlayBounds(window: BrowserWindow) {
    const bounds = this.getTargetBounds();
    if (process.platform === "linux") {
      if (!window.isFullScreen()) window.setFullScreen(true);
      return;
    }
    window.setBounds(bounds);
  }

  private static startTargetPolling() {
    this.stopTargetPolling();
    this.targetPoll = setInterval(() => {
      const game = this.activeGame;
      if (!game) return;
      if (Date.now() - this.lastTargetRefreshAt >= 2_000) {
        void this.refreshTargetProcess(game);
      }
      const bounds = this.getTargetBounds();
      if (this.overlayWindow?.isVisible()) {
        this.placeWindowOverGame(this.overlayWindow);
      }
      if (this.toastWindow?.isVisible()) {
        this.toastWindow.setPosition(
          bounds.x + bounds.width - TOAST_WIDTH - TOAST_MARGIN,
          bounds.y + TOAST_MARGIN
        );
      }
      if (this.fpsWindow?.isVisible()) {
        this.fpsWindow.setPosition(bounds.x + 24, bounds.y + 24);
      }
    }, 250);
  }

  private static stopTargetPolling() {
    if (this.targetPoll) clearInterval(this.targetPoll);
    this.targetPoll = null;
    this.targetRefreshPending = false;
    this.lastTargetRefreshAt = 0;
  }

  private static showActivationToast() {
    this.destroyToast();

    if (process.platform === "linux") {
      this.showLinuxActivationToast();
      return;
    }

    const targetBounds = this.getTargetBounds();
    const toastWindow = new BrowserWindow({
      x: targetBounds.x + targetBounds.width - TOAST_WIDTH - TOAST_MARGIN,
      y: targetBounds.y + TOAST_MARGIN,
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
      },
    });

    toastWindow.removeMenu();
    toastWindow.setIgnoreMouseEvents(true);
    toastWindow.setAlwaysOnTop(true, "screen-saver", 1);
    WindowManager.loadWindowURL(toastWindow, "overlay-toast");
    toastWindow.once("ready-to-show", () => toastWindow.showInactive());
    toastWindow.on("closed", () => {
      if (this.toastWindow === toastWindow) this.toastWindow = null;
    });

    this.toastWindow = toastWindow;
    this.toastTimer = setTimeout(() => {
      if (this.toastWindow === toastWindow) this.destroyToast();
    }, 8_000);
  }

  private static showLinuxActivationToast() {
    const overlayWindow = this.ensureOverlayWindow();
    const toastSequence = ++this.toastSequence;
    const show = () => {
      if (
        toastSequence !== this.toastSequence ||
        overlayWindow.isDestroyed() ||
        !this.activeGame
      ) {
        return;
      }
      this.linuxToastActive = true;
      overlayWindow.webContents.send("on-overlay-mode", "toast");
      overlayWindow.setOpacity(0);
      this.setOverlayBounds(overlayWindow);
      overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);
      overlayWindow.showInactive();
      overlayWindow.moveTop();
      this.fadeOverlayWindow(1);
      overlayWindow.webContents.send("on-overlay-shown");
    };

    if (overlayWindow.webContents.isLoadingMainFrame()) {
      overlayWindow.webContents.once("did-finish-load", show);
    } else {
      show();
    }
    this.toastTimer = setTimeout(() => {
      if (toastSequence === this.toastSequence) this.destroyToast();
    }, 8_000);
  }

  private static destroyToast() {
    this.toastSequence += 1;
    this.clearToastTimer();
    if (this.toastWindow && !this.toastWindow.isDestroyed()) {
      this.toastWindow.destroy();
    }
    this.toastWindow = null;
    if (!this.linuxToastActive) return;
    this.linuxToastActive = false;
    const overlayWindow = this.overlayWindow;
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send("on-overlay-mode", "hidden");
    overlayWindow.hide();
    overlayWindow.setOpacity(1);
  }

  private static clearToastTimer() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
  }

  private static updatePerformance(metrics: HydraOverlayPerformance) {
    this.performance = metrics;
    if (!this.activeGame) return;
    this.fpsWindow?.webContents.send("on-overlay-performance", metrics);
    this.overlayWindow?.webContents.send("on-overlay-performance", metrics);
  }

  private static readPreferences(preferences: UserPreferences | null) {
    this.preferences = resolveHydraOverlayPreferences(preferences);
  }

  private static notifyOverlayContextChanged() {
    this.fpsWindow?.webContents.send("on-overlay-shown");
    this.overlayWindow?.webContents.send("on-overlay-shown");
  }

  private static stopActiveServices() {
    if (!this.servicesActive) return;
    this.servicesActive = false;
    this.hideOverlay();
    this.destroyToast();
    this.unregisterShortcut();
    this.stopControllerPolling();
    NativeAddon.stopOverlayInputBroker();
    this.stopTargetPolling();
    overlayFpsMonitor.stop();
    this.destroyFpsWindow();
    this.performancePinned = false;
    this.performance = emptyPerformance();
    this.targetPid = 0;
  }

  private static showFpsWindow() {
    if (process.platform === "linux") return;
    const fpsWindow = this.ensureFpsWindow();
    const show = () => {
      if (!fpsWindow.isDestroyed() && this.performancePinned) {
        fpsWindow.showInactive();
      }
    };
    if (fpsWindow.webContents.isLoadingMainFrame()) {
      fpsWindow.webContents.once("did-finish-load", show);
    } else {
      show();
    }
  }

  private static ensureFpsWindow() {
    if (this.fpsWindow && !this.fpsWindow.isDestroyed()) return this.fpsWindow;
    const targetBounds = this.getTargetBounds();
    const fpsWindow = new BrowserWindow({
      x: targetBounds.x + 24,
      y: targetBounds.y + 24,
      width: FPS_WIDTH,
      height: FPS_HEIGHT,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      focusable: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.mjs"),
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    fpsWindow.removeMenu();
    fpsWindow.setIgnoreMouseEvents(true);
    fpsWindow.setAlwaysOnTop(true, "screen-saver", 1);
    if (process.platform === "linux") {
      fpsWindow.setVisibleOnAllWorkspaces(true);
      NativeAddon.markGamescopeOverlay(fpsWindow.getNativeWindowHandle(), true);
    }
    WindowManager.loadWindowURL(fpsWindow, "overlay-fps");
    fpsWindow.on("closed", () => {
      if (this.fpsWindow === fpsWindow) this.fpsWindow = null;
    });
    this.fpsWindow = fpsWindow;
    return fpsWindow;
  }

  private static destroyFpsWindow() {
    if (this.fpsWindow && !this.fpsWindow.isDestroyed())
      this.fpsWindow.destroy();
    this.fpsWindow = null;
  }

  private static registerShortcut(nativeKeyboardActive: boolean) {
    this.unregisterShortcut();

    this.registeredShortcut = PREFERRED_SHORTCUT;
    if (process.platform === "win32" && nativeKeyboardActive) {
      logger.info("Using native Windows Hydra overlay shortcut watcher");
      return;
    }

    if (
      globalShortcut.register(PREFERRED_SHORTCUT, () => this.toggleOverlay())
    ) {
      this.registeredWithElectron = true;
      return;
    }

    if (process.platform === "win32") {
      logger.warn(
        "Shift+Tab OS registration failed; native overlay polling remains active"
      );
      return;
    }

    logger.warn("Could not register a global Hydra overlay shortcut");
  }

  private static unregisterShortcut() {
    if (this.registeredShortcut && this.registeredWithElectron) {
      globalShortcut.unregister(this.registeredShortcut);
    }
    this.registeredShortcut = null;
    this.registeredWithElectron = false;
  }

  private static startControllerPolling() {
    this.stopControllerPolling();
    const rawInputActive =
      process.platform === "win32" && NativeAddon.startOverlayKeyboardWatcher();
    if (!rawInputActive && process.platform === "win32") {
      logger.warn("Hydra Raw Input shortcut watcher could not be started");
    }
    this.keyboardEventCount = NativeAddon.getOverlayKeyboardEventCount();
    this.controllerPoll = setInterval(() => {
      const keyboardEventCount = NativeAddon.getOverlayKeyboardEventCount();
      const gamepadButtons = NativeAddon.getOverlayGamepadButtons();
      const isPressed =
        (gamepadButtons & GAMEPAD_OVERLAY_CHORD) === GAMEPAD_OVERLAY_CHORD;
      if (keyboardEventCount !== this.keyboardEventCount) {
        this.toggleOverlay();
      }
      if (isPressed && !this.wasControllerChordPressed) this.toggleOverlay();
      this.processGamepadNavigation(gamepadButtons);
      this.keyboardEventCount = keyboardEventCount;
      this.wasControllerChordPressed = isPressed;
    }, 32);
    return rawInputActive;
  }

  private static stopControllerPolling() {
    if (this.controllerPoll) clearInterval(this.controllerPoll);
    this.controllerPoll = null;
    this.keyboardEventCount = 0;
    this.wasControllerChordPressed = false;
    this.previousGamepadButtons = 0;
    this.repeatingGamepadButton = 0;
    this.nextGamepadRepeatAt = 0;
  }

  private static processGamepadNavigation(buttons: number) {
    const overlayVisible = Boolean(this.overlayWindow?.isVisible());
    if (!overlayVisible) {
      this.previousGamepadButtons = buttons;
      this.repeatingGamepadButton = 0;
      return;
    }

    const risingButtons = buttons & ~this.previousGamepadButtons;
    const risingAction = GAMEPAD_ACTIONS.find(
      ([button]) => (risingButtons & button) !== 0
    );
    const now = Date.now();
    if (risingAction) {
      this.sendGamepadAction(risingAction[1]);
      if ((risingAction[0] & GAMEPAD_DIRECTION_MASK) !== 0) {
        this.repeatingGamepadButton = risingAction[0];
        this.nextGamepadRepeatAt = now + GAMEPAD_REPEAT_DELAY_MS;
      }
    } else {
      const heldDirection = GAMEPAD_ACTIONS.find(
        ([button]) =>
          (button & GAMEPAD_DIRECTION_MASK) !== 0 && (buttons & button) !== 0
      );
      if (!heldDirection) {
        this.repeatingGamepadButton = 0;
      } else if (this.repeatingGamepadButton !== heldDirection[0]) {
        this.repeatingGamepadButton = heldDirection[0];
        this.nextGamepadRepeatAt = now + GAMEPAD_REPEAT_DELAY_MS;
      } else if (now >= this.nextGamepadRepeatAt) {
        this.sendGamepadAction(heldDirection[1]);
        this.nextGamepadRepeatAt = now + GAMEPAD_REPEAT_INTERVAL_MS;
      }
    }
    this.previousGamepadButtons = buttons;
  }

  private static sendGamepadAction(action: HydraOverlayGamepadAction) {
    this.overlayWindow?.webContents.send("on-overlay-gamepad-action", action);
  }

  private static dispose() {
    this.stopActiveServices();
    this.performance = emptyPerformance();
  }
}
