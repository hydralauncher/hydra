import { BrowserWindow, Notification } from "electron";
import { t } from "i18next";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import icon from "@resources/icon.png?asset";
import soundPagePath from "@resources/screenshot-sound.html?asset";
import { achievementSoundPath } from "@main/constants";
import { getThemeSoundPath } from "@main/helpers";
import { db, levelKeys, themesSublevel } from "@main/level";
import { resolveScreenshotPreferences } from "@shared";
import type { ScreenshotFeedbackToast, UserPreferences } from "@types";

import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { logger } from "../logger";

const DEFAULT_CAPTURE_SOUND_VOLUME = 0.15;
const DEFAULT_TOAST_POSITION = "top-left";
const ALWAYS_SHOWN_TOASTS = new Set<ScreenshotFeedbackToast["kind"]>([
  "disabled_for_game",
  "capture_failed",
]);

interface SoundWindow {
  window: BrowserWindow;
  ready: Promise<boolean>;
}

let soundWindow: SoundWindow | null = null;
let soundWindowFailed = false;

const readUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

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

const resolveCaptureSoundUrl = async () => {
  try {
    const themes = await themesSublevel.values().all();
    const activeTheme = themes.find((theme) => theme.isActive);
    if (activeTheme?.hasCustomSound) {
      const soundPath = getThemeSoundPath(activeTheme.id, activeTheme.name);
      if (soundPath && fs.existsSync(soundPath)) {
        return pathToFileURL(soundPath).href;
      }
    }
  } catch (error) {
    logger.warn("Could not resolve the theme capture sound", error);
  }
  return pathToFileURL(achievementSoundPath).href;
};

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

    const soundUrl = await resolveCaptureSoundUrl();
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
  }

  public static async showToast(
    toast: ScreenshotFeedbackToast,
    { ignorePreference = false }: { ignorePreference?: boolean } = {}
  ) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    if (
      !ignorePreference &&
      !ALWAYS_SHOWN_TOASTS.has(toast.kind) &&
      !preferences.toastEnabled
    ) {
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
