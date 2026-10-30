import { globalShortcut } from "electron";
import type {
  ScreenshotGamepadButton,
  ScreenshotHotkeyBinding,
  ScreenshotInputBackend,
  ScreenshotInputHint,
  ScreenshotInputStatus,
  ScreenshotTriggerSource,
  UserPreferences,
} from "@types";
import {
  isSameScreenshotGamepadCombo,
  isSameScreenshotHotkey,
  normalizeScreenshotGamepadCombo,
  normalizeScreenshotHotkey,
  toScreenshotHotkeyAccelerator,
} from "@shared";

import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { logger } from "./logger";
import {
  NativeAddon,
  type ScreenshotInputNativeConfig,
  type ScreenshotInputNativeEvent,
  type ScreenshotInputNativeStatus,
} from "./native-addon";
import {
  isScreenshotsFeatureEnabled,
  onScreenshotsFeatureChange,
} from "./screenshots/screenshot-feature";

type ScreenshotTriggerListener = (source: ScreenshotTriggerSource) => void;
type ScreenshotTriggerChannel = "input" | "deeplink";
type ScreenshotInputStatusListener = (status: ScreenshotInputStatus) => void;

export const SCREENSHOT_TRIGGER_COOLDOWN_MS = 500;
export const SCREENSHOT_INPUT_RESTART_DELAY_MS = 5_000;
export const SCREENSHOT_INPUT_MAX_RESTARTS = 3;
export const SCREENSHOT_INPUT_STABLE_RUN_MS = 60_000;

export interface ScreenshotInputSettings {
  enabled: boolean;
  hotkey: ScreenshotHotkeyBinding;
  gamepadEnabled: boolean;
  gamepadCombo: ScreenshotGamepadButton[];
}

const SCREENSHOT_INPUT_BACKENDS = new Set<ScreenshotInputBackend>([
  "windows-raw-input",
  "xinput",
  "x11-xinput2",
  "evdev",
  "global-shortcuts-portal",
  "unavailable",
]);

const INACTIVE_STATUS: ScreenshotInputStatus = {
  active: false,
  keyboardBackend: "unavailable",
  gamepadBackend: "unavailable",
  hint: null,
};

export const getScreenshotInputSettings = (
  preferences: UserPreferences | null | undefined
): ScreenshotInputSettings => ({
  enabled: preferences?.screenshotsEnabled ?? true,
  hotkey: normalizeScreenshotHotkey(preferences?.screenshotHotkey),
  gamepadEnabled: preferences?.screenshotGamepadEnabled ?? true,
  gamepadCombo: normalizeScreenshotGamepadCombo(
    preferences?.screenshotGamepadCombo
  ),
});

export const toScreenshotInputNativeConfig = (
  settings: ScreenshotInputSettings
): ScreenshotInputNativeConfig => ({
  key: settings.hotkey.key,
  ctrl: settings.hotkey.ctrl,
  alt: settings.hotkey.alt,
  shift: settings.hotkey.shift,
  gamepadEnabled: settings.gamepadEnabled,
  gamepadButtons: [...settings.gamepadCombo],
});

const toBackend = (value: string): ScreenshotInputBackend =>
  SCREENSHOT_INPUT_BACKENDS.has(value as ScreenshotInputBackend)
    ? (value as ScreenshotInputBackend)
    : "unavailable";

export const getScreenshotInputHint = (
  status: ScreenshotInputNativeStatus,
  gamepadEnabled: boolean
): ScreenshotInputHint | null => {
  const keyboardBackend = toBackend(status.keyboardBackend);

  if (keyboardBackend === "unavailable") {
    return status.waylandSession
      ? "hotkey_unavailable_wayland"
      : "hotkey_unavailable";
  }

  if (keyboardBackend === "x11-xinput2" && status.waylandSession) {
    return "hotkey_xwayland_only";
  }

  if (
    gamepadEnabled &&
    (status.gamepadError || toBackend(status.gamepadBackend) === "unavailable")
  ) {
    return "gamepad_unavailable";
  }

  return null;
};

export const toScreenshotInputStatus = (
  status: ScreenshotInputNativeStatus,
  settings: ScreenshotInputSettings,
  active: boolean
): ScreenshotInputStatus => ({
  active,
  keyboardBackend: toBackend(status.keyboardBackend),
  gamepadBackend: toBackend(status.gamepadBackend),
  hint: getScreenshotInputHint(status, settings.gamepadEnabled),
});

const shouldUsePortalShortcut = (status: ScreenshotInputNativeStatus) =>
  process.platform === "linux" &&
  status.waylandSession &&
  toBackend(status.keyboardBackend) === "unavailable";

const withPortalHotkeyHint = (
  status: ScreenshotInputStatus,
  nativeStatus: ScreenshotInputNativeStatus,
  settings: ScreenshotInputSettings
): ScreenshotInputStatus =>
  shouldUsePortalShortcut(nativeStatus) &&
  !toScreenshotHotkeyAccelerator(settings.hotkey)
    ? { ...status, hint: "hotkey_portal_unsupported_key" }
    : status;

const withPortalKeyboard = (
  status: ScreenshotInputNativeStatus
): ScreenshotInputNativeStatus => ({
  ...status,
  keyboardBackend: "global-shortcuts-portal",
  keyboardError: undefined,
});

const isNativeTriggerSource = (
  source: string
): source is "keyboard" | "gamepad" =>
  source === "keyboard" || source === "gamepad";

const isSameStatus = (
  left: ScreenshotInputStatus,
  right: ScreenshotInputStatus
) =>
  left.active === right.active &&
  left.keyboardBackend === right.keyboardBackend &&
  left.gamepadBackend === right.gamepadBackend &&
  left.hint === right.hint;

export class ScreenshotInputService {
  private static readonly listeners = new Set<ScreenshotTriggerListener>();
  private static readonly statusListeners =
    new Set<ScreenshotInputStatusListener>();

  private static status: ScreenshotInputStatus = { ...INACTIVE_STATUS };
  private static settings = getScreenshotInputSettings(null);
  private static initialized = false;
  private static shuttingDown = false;
  private static listening = false;
  private static sessionGeneration = 0;
  private static gamesRunning = false;
  private static featureEnabled = false;
  private static readonly lastTriggerAt = new Map<
    ScreenshotTriggerChannel,
    number
  >();
  private static restartAttempts = 0;
  private static listeningSince: number | null = null;
  private static restartTimer: ReturnType<typeof setTimeout> | null = null;
  private static portalAccelerator: string | null = null;
  private static nativeStatus: ScreenshotInputNativeStatus | null = null;
  private static pendingGamesRunningCheck: ReturnType<
    typeof setImmediate
  > | null = null;
  private static unsubscribeGamesRunning: (() => void) | null = null;
  private static unsubscribeFeature: (() => void) | null = null;

  public static onTrigger(listener: ScreenshotTriggerListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public static onStatusChange(listener: ScreenshotInputStatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public static trigger(source: ScreenshotTriggerSource) {
    if (!this.featureEnabled || !this.settings.enabled) {
      logger.debug("Screenshot trigger ignored: input disabled", {
        source,
        featureEnabled: this.featureEnabled,
        settingsEnabled: this.settings.enabled,
      });
      return false;
    }
    if (!hasTrackedGamesRunning()) {
      logger.debug("Screenshot trigger ignored: no tracked game running", {
        source,
      });
      return false;
    }

    const channel: ScreenshotTriggerChannel =
      source === "deeplink" ? "deeplink" : "input";
    const now = performance.now();
    const lastTriggerAt = this.lastTriggerAt.get(channel);
    if (
      lastTriggerAt !== undefined &&
      now - lastTriggerAt < SCREENSHOT_TRIGGER_COOLDOWN_MS
    ) {
      logger.debug("Screenshot trigger ignored: cooldown", {
        source,
        sinceLastTriggerMs: Math.round(now - lastTriggerAt),
      });
      return false;
    }
    this.lastTriggerAt.set(channel, now);

    for (const listener of this.listeners) {
      try {
        listener(source);
      } catch (error) {
        logger.error("Screenshot trigger listener failed", error);
      }
    }

    return true;
  }

  public static syncUserPreferences(preferences: UserPreferences | null) {
    const previous = this.settings;
    this.settings = getScreenshotInputSettings(preferences);

    if (!this.initialized) {
      this.initialized = true;
      this.gamesRunning = hasTrackedGamesRunning();
      this.unsubscribeGamesRunning = onTrackedGamesRunningChange(() =>
        this.scheduleTrackedGamesRunningCheck()
      );
      this.unsubscribeFeature = onScreenshotsFeatureChange((enabled) =>
        this.applyFeatureFlag(enabled)
      );
    }

    this.reconcile(previous);
  }

  public static refreshStatus(): ScreenshotInputStatus {
    if (this.listening || this.shuttingDown) return this.status;
    if (!this.featureEnabled) {
      this.setStatus({ ...INACTIVE_STATUS });
      void this.refreshFeatureFlag();
      return this.status;
    }

    try {
      const probe = NativeAddon.probeScreenshotInput(
        toScreenshotInputNativeConfig(this.settings)
      );
      this.setStatus(
        withPortalHotkeyHint(
          toScreenshotInputStatus(probe, this.settings, false),
          probe,
          this.settings
        )
      );
    } catch (error) {
      logger.error("Failed to probe screenshot input backends", error);
    }

    return this.status;
  }

  public static shutdown() {
    this.shuttingDown = true;
    this.cancelRestart();
    this.cancelTrackedGamesRunningCheck();
    this.unsubscribeGamesRunning?.();
    this.unsubscribeGamesRunning = null;
    this.unsubscribeFeature?.();
    this.unsubscribeFeature = null;
    this.stopListening();
  }

  private static scheduleTrackedGamesRunningCheck() {
    if (this.pendingGamesRunningCheck) return;
    this.pendingGamesRunningCheck = setImmediate(() => {
      this.pendingGamesRunningCheck = null;
      this.handleTrackedGamesRunningChange();
    });
  }

  private static cancelTrackedGamesRunningCheck() {
    if (!this.pendingGamesRunningCheck) return;
    clearImmediate(this.pendingGamesRunningCheck);
    this.pendingGamesRunningCheck = null;
  }

  private static handleTrackedGamesRunningChange() {
    const gamesRunning = hasTrackedGamesRunning();
    if (gamesRunning === this.gamesRunning) return;

    this.gamesRunning = gamesRunning;
    this.reconcile(this.settings);
    if (gamesRunning) void this.refreshFeatureFlag();
  }

  public static async refreshFeatureFlag() {
    try {
      this.applyFeatureFlag(await isScreenshotsFeatureEnabled());
    } catch (error) {
      logger.error("Failed to read the screenshots feature flag", error);
    }
  }

  private static applyFeatureFlag(featureEnabled: boolean) {
    if (this.shuttingDown || featureEnabled === this.featureEnabled) return;
    this.featureEnabled = featureEnabled;
    this.reconcile(this.settings);
    if (!this.listening) this.refreshStatus();
  }

  private static shouldListen() {
    return (
      this.initialized &&
      !this.shuttingDown &&
      this.featureEnabled &&
      this.settings.enabled &&
      this.gamesRunning
    );
  }

  private static reconcile(previous: ScreenshotInputSettings) {
    if (!this.shouldListen()) {
      this.cancelRestart();
      this.restartAttempts = 0;
      this.stopListening();
      return;
    }

    if (!this.listening) {
      this.startListening();
      return;
    }

    if (previous.gamepadEnabled !== this.settings.gamepadEnabled) {
      this.stopListening();
      this.startListening();
      return;
    }

    if (
      !isSameScreenshotHotkey(previous.hotkey, this.settings.hotkey) &&
      this.nativeStatus
    ) {
      this.unregisterPortalShortcut();
      this.applyListeningStatus(this.nativeStatus);
    }

    if (
      !isSameScreenshotHotkey(previous.hotkey, this.settings.hotkey) ||
      !isSameScreenshotGamepadCombo(
        previous.gamepadCombo,
        this.settings.gamepadCombo
      )
    ) {
      try {
        NativeAddon.updateScreenshotInputBinding(
          toScreenshotInputNativeConfig(this.settings)
        );
      } catch (error) {
        logger.error("Failed to update screenshot input binding", error);
      }
    }
  }

  private static startListening() {
    const generation = ++this.sessionGeneration;
    try {
      const nativeStatus = NativeAddon.startScreenshotInput(
        toScreenshotInputNativeConfig(this.settings),
        (event) => this.handleNativeEvent(event, generation)
      );
      this.listening = true;
      this.listeningSince = performance.now();
      this.nativeStatus = nativeStatus;
      const status = this.applyListeningStatus(nativeStatus);
      logger.info("Screenshot input started", {
        ...status,
        keyboardError: nativeStatus.keyboardError ?? null,
        gamepadError: nativeStatus.gamepadError ?? null,
      });
    } catch (error) {
      logger.error("Failed to start screenshot input", error);
      this.listening = false;
      this.setStatus({ ...INACTIVE_STATUS, hint: "hotkey_unavailable" });
    }
  }

  private static applyListeningStatus(
    nativeStatus: ScreenshotInputNativeStatus
  ) {
    const effectiveStatus =
      shouldUsePortalShortcut(nativeStatus) && this.registerPortalShortcut()
        ? withPortalKeyboard(nativeStatus)
        : nativeStatus;
    const status = toScreenshotInputStatus(
      effectiveStatus,
      this.settings,
      true
    );
    const nextStatus = withPortalHotkeyHint(
      status,
      nativeStatus,
      this.settings
    );
    this.setStatus(nextStatus);
    return nextStatus;
  }

  private static registerPortalShortcut() {
    const accelerator = toScreenshotHotkeyAccelerator(this.settings.hotkey);
    if (!accelerator) return false;
    if (this.portalAccelerator === accelerator) return true;

    this.unregisterPortalShortcut();
    try {
      const registered = globalShortcut.register(accelerator, () => {
        if (this.listening) this.trigger("portal");
      });
      if (!registered) {
        logger.warn("Screenshot portal shortcut was not registered", {
          accelerator,
        });
        return false;
      }
      this.portalAccelerator = accelerator;
      return true;
    } catch (error) {
      logger.error("Failed to register the screenshot portal shortcut", error);
      return false;
    }
  }

  private static unregisterPortalShortcut() {
    const accelerator = this.portalAccelerator;
    if (!accelerator) return;
    this.portalAccelerator = null;

    try {
      globalShortcut.unregister(accelerator);
    } catch (error) {
      logger.error(
        "Failed to unregister the screenshot portal shortcut",
        error
      );
    }
  }

  private static stopListening() {
    if (!this.listening) return;
    this.listening = false;
    this.nativeStatus = null;
    this.unregisterPortalShortcut();

    try {
      NativeAddon.stopScreenshotInput();
    } catch (error) {
      logger.error("Failed to stop screenshot input", error);
    }

    logger.info("Screenshot input stopped");
    this.setStatus({ ...this.status, active: false });
  }

  private static handleNativeEvent(
    event: ScreenshotInputNativeEvent,
    generation: number
  ) {
    if (!this.listening || generation !== this.sessionGeneration) {
      logger.debug("Screenshot native event ignored: not listening", {
        kind: event.kind,
        source: event.source,
      });
      return;
    }

    if (event.kind === "stopped") {
      this.handleBackendStopped(event);
      return;
    }

    logger.debug("Screenshot native trigger", {
      source: event.source,
      backend: event.backend,
    });
    if (isNativeTriggerSource(event.source)) this.trigger(event.source);
  }

  private static handleBackendStopped(event: ScreenshotInputNativeEvent) {
    if (
      this.listeningSince !== null &&
      performance.now() - this.listeningSince >= SCREENSHOT_INPUT_STABLE_RUN_MS
    ) {
      this.restartAttempts = 0;
    }

    logger.warn("Screenshot input backend stopped unexpectedly", {
      source: event.source,
      backend: event.backend,
      restartAttempts: this.restartAttempts,
    });
    this.stopListening();
    this.refreshStatus();

    if (this.restartAttempts >= SCREENSHOT_INPUT_MAX_RESTARTS) return;

    this.restartAttempts += 1;
    this.cancelRestart();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.reconcile(this.settings);
    }, SCREENSHOT_INPUT_RESTART_DELAY_MS);
    this.restartTimer.unref?.();
  }

  private static cancelRestart() {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private static setStatus(status: ScreenshotInputStatus) {
    if (isSameStatus(this.status, status)) return;
    this.status = status;

    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        logger.error("Screenshot input status listener failed", error);
      }
    }
  }
}
