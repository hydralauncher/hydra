import { BrowserWindow, Notification } from "electron";
import { t } from "i18next";
import { pathToFileURL } from "node:url";
import icon from "@resources/icon.png?asset";
import captureSoundPath from "@resources/screenshot.mp3?asset";
import failureSoundPath from "@resources/screenshot-error.mp3?asset";
import soundPagePath from "@resources/screenshot-sound.html?asset";
import { resolveScreenshotPreferences } from "@shared";
import type {
  AchievementNotificationInfo,
  ScreenshotFailureKind,
  ScreenshotFailureToast,
  ScreenshotFeedbackToast,
  UserPreferences,
} from "@types";

import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { hasTrackedGamesRunning } from "../game-running-state";
import { logger } from "../logger";
import { readUserPreferences } from "./screenshot-user-preferences";

const DEFAULT_CAPTURE_SOUND_VOLUME = 0.15;
const DEFAULT_TOAST_POSITION = "top-left";
const IDLE_SOUND_WINDOW_RELEASE_MS = 30_000;
const FAILURE_DESCRIPTION_KEYS: Record<ScreenshotFailureKind, string> = {
  game_not_recognized: "capture_error_game_not_recognized",
  game_not_focused: "capture_error_game_not_focused",
  window_capture_failed: "capture_error_window_capture_failed",
  blank_frame: "capture_error_blank_frame",
  disk_full: "capture_error_disk_full",
  file_write_failed: "capture_error_file_write_failed",
  save_failed: "capture_error_save_failed",
  unexpected_error: "capture_error_unexpected",
  share_unavailable: "share_unavailable",
};

interface SoundWindow {
  window: BrowserWindow;
  ready: Promise<boolean>;
}

let soundWindow: SoundWindow | null = null;
let soundWindowFailed = false;
let idleSoundWindowTimer: ReturnType<typeof setTimeout> | null = null;

const destroyWindow = (window: BrowserWindow) => {
  if (!window.isDestroyed()) window.destroy();
};

const createSoundWindow = (): SoundWindow => {
  const window = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.removeMenu();

  const ready = window.loadFile(soundPagePath).then(
    () => true,
    (error) => {
      if (window.isDestroyed()) return false;
      logger.error("Failed to load the screenshot sound window", error);
      soundWindowFailed = true;
      if (soundWindow?.window === window) soundWindow = null;
      destroyWindow(window);
      return false;
    }
  );

  return { window, ready };
};

const captureSoundUrl = pathToFileURL(captureSoundPath).href;
const failureSoundUrl = pathToFileURL(failureSoundPath).href;

const showOsNotification = (title: string, body: string) => {
  try {
    new Notification({ title, body, icon, silent: true }).show();
  } catch (error) {
    logger.error("Failed to show the screenshot notification", error);
  }
};

const usesCustomNotifications = (userPreferences: UserPreferences | null) =>
  process.platform === "win32" &&
  userPreferences?.achievementCustomNotificationsEnabled !== false;

const presentToast = (
  userPreferences: UserPreferences | null,
  title: string,
  description: string,
  variant: AchievementNotificationInfo["variant"]
) => {
  if (!usesCustomNotifications(userPreferences)) {
    showOsNotification(title, description);
    return;
  }

  achievementNotificationPresenter.enqueueScreenshot(
    userPreferences?.achievementCustomNotificationPosition ??
      DEFAULT_TOAST_POSITION,
    {
      title,
      description,
      iconUrl: "",
      isHidden: false,
      isRare: false,
      isPlatinum: false,
      variant,
    },
    () => showOsNotification(title, description)
  );
};

const clearIdleSoundWindowTimer = () => {
  if (!idleSoundWindowTimer) return;
  clearTimeout(idleSoundWindowTimer);
  idleSoundWindowTimer = null;
};

export class ScreenshotFeedback {
  public static prepare() {
    if (soundWindow && !soundWindow.window.isDestroyed()) return;
    if (soundWindowFailed) return;
    soundWindow = createSoundWindow();
  }

  public static async prepareToast() {
    const userPreferences = await readUserPreferences();
    if (!usesCustomNotifications(userPreferences)) return;

    achievementNotificationPresenter.keepWarm(
      userPreferences?.achievementCustomNotificationPosition ??
        DEFAULT_TOAST_POSITION
    );
  }

  public static release() {
    clearIdleSoundWindowTimer();
    if (soundWindow) destroyWindow(soundWindow.window);
    soundWindow = null;
    soundWindowFailed = false;
    achievementNotificationPresenter.releaseWarm();
  }

  public static playCaptureSound() {
    return this.playSound(captureSoundUrl);
  }

  public static playFailureSound() {
    return this.playSound(failureSoundUrl);
  }

  private static scheduleIdleRelease() {
    if (hasTrackedGamesRunning()) return;

    clearIdleSoundWindowTimer();
    idleSoundWindowTimer = setTimeout(() => {
      idleSoundWindowTimer = null;
      if (!hasTrackedGamesRunning()) this.release();
    }, IDLE_SOUND_WINDOW_RELEASE_MS);
    idleSoundWindowTimer.unref?.();
  }

  private static async playSound(soundUrl: string) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    if (!preferences.captureSoundEnabled) return;

    try {
      this.prepare();
      const current = soundWindow;
      if (!current) return;

      const volume =
        userPreferences?.achievementSoundVolume ?? DEFAULT_CAPTURE_SOUND_VOLUME;
      if (!(await current.ready) || current.window.isDestroyed()) return;

      await current.window.webContents
        .executeJavaScript(
          `globalThis.hydraScreenshotSound(${JSON.stringify(soundUrl)}, ${JSON.stringify(volume)})`
        )
        .catch((error) => {
          logger.error("Failed to play the screenshot sound", error);
        });
    } finally {
      this.scheduleIdleRelease();
    }
  }

  public static async showToast(toast: ScreenshotFeedbackToast) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    if (toast.kind !== "share_pending" && !preferences.toastEnabled) return;

    presentToast(
      userPreferences,
      t(toast.kind, { ns: "screenshots_capture" }),
      toast.gameTitle,
      "screenshot"
    );
  }

  public static async showFailureToast(toast: ScreenshotFailureToast) {
    presentToast(
      await readUserPreferences(),
      t("capture_failed", { ns: "screenshots_capture" }),
      t(FAILURE_DESCRIPTION_KEYS[toast.kind], {
        ns: "screenshots_capture",
        game: toast.gameTitle,
      }),
      "screenshot-error"
    );
  }
}
