import { BrowserWindow, Notification } from "electron";
import { t } from "i18next";
import { pathToFileURL } from "node:url";
import icon from "@resources/icon.png?asset";
import captureSoundPath from "@resources/screenshot.mp3?asset";
import soundPagePath from "@resources/screenshot-sound.html?asset";
import { resolveScreenshotPreferences } from "@shared";
import type { ScreenshotFeedbackToast, UserPreferences } from "@types";

import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { logger } from "../logger";
import { readUserPreferences } from "./screenshot-user-preferences";

const DEFAULT_CAPTURE_SOUND_VOLUME = 0.15;
const DEFAULT_TOAST_POSITION = "top-left";
const ALWAYS_SHOWN_TOASTS = new Set<ScreenshotFeedbackToast["kind"]>([
  "capture_failed",
  "share_pending",
  "share_unavailable",
]);

interface SoundWindow {
  window: BrowserWindow;
  ready: Promise<boolean>;
}

let soundWindow: SoundWindow | null = null;
let soundWindowFailed = false;

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
    if (soundWindow) destroyWindow(soundWindow.window);
    soundWindow = null;
    soundWindowFailed = false;
    achievementNotificationPresenter.releaseWarm();
  }

  public static async playCaptureSound() {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    if (!preferences.captureSoundEnabled) return;

    this.prepare();
    const current = soundWindow;
    if (!current) return;

    const volume =
      userPreferences?.achievementSoundVolume ?? DEFAULT_CAPTURE_SOUND_VOLUME;
    if (!(await current.ready) || current.window.isDestroyed()) return;

    await current.window.webContents
      .executeJavaScript(
        `globalThis.hydraScreenshotSound(${JSON.stringify(captureSoundUrl)}, ${JSON.stringify(volume)})`
      )
      .catch((error) => {
        logger.error("Failed to play the screenshot sound", error);
      });
  }

  public static async showToast(toast: ScreenshotFeedbackToast) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    if (!ALWAYS_SHOWN_TOASTS.has(toast.kind) && !preferences.toastEnabled) {
      return;
    }

    const title = t(toast.kind, { ns: "screenshots_capture" });
    const description = toast.gameTitle;

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
      },
      () => showOsNotification(title, description)
    );
  }
}
