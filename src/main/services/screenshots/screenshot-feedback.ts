import { BrowserWindow, Notification, nativeImage, screen } from "electron";
import { t } from "i18next";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import icon from "@resources/icon.png?asset";
import flashPagePath from "@resources/screenshot-flash.html?asset";
import { achievementSoundPath } from "@main/constants";
import { getThemeSoundPath } from "@main/helpers";
import { db, levelKeys, themesSublevel } from "@main/level";
import { resolveScreenshotPreferences } from "@shared";
import type { ScreenshotFeedbackToast, UserPreferences } from "@types";

import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { isWaylandSession } from "../linux-game-capture-session";
import { logger } from "../logger";
import { SystemPath } from "../system-path";

const FLASH_VISIBLE_DURATION_MS = 700;
const DEFAULT_CAPTURE_SOUND_VOLUME = 0.15;
const TOAST_THUMBNAIL_WIDTH = 320;
const TOAST_THUMBNAIL_JPEG_QUALITY = 80;
const MAX_TOAST_THUMBNAILS = 20;

interface FeedbackWindow {
  window: BrowserWindow;
  ready: Promise<boolean>;
  bounds: Electron.Rectangle | null;
  isPrimary: boolean;
}

const SOUND_WINDOW_KEY = "sound";

const feedbackWindows = new Map<string, FeedbackWindow>();
const failedWindowKeys = new Set<string>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let displayListenersRegistered = false;
let isSyncingFlashWindows = false;

const readUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const canShowFlashWindows = () =>
  (process.platform === "win32" || process.platform === "linux") &&
  !isWaylandSession();

const toDisplayKey = (displayId: number) => `display:${displayId}`;

const isSameBounds = (left: Electron.Rectangle, right: Electron.Rectangle) =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

const destroyWindow = (window: BrowserWindow) => {
  if (!window.isDestroyed()) window.destroy();
};

const loadFeedbackPage = (key: string, window: BrowserWindow) =>
  window.loadFile(flashPagePath).then(
    () => true,
    (error) => {
      if (window.isDestroyed()) return false;
      logger.error("Failed to load the screenshot feedback window", error);
      failedWindowKeys.add(key);
      if (feedbackWindows.get(key)?.window === window) {
        feedbackWindows.delete(key);
      }
      destroyWindow(window);
      return false;
    }
  );

const createFlashWindow = (
  key: string,
  bounds: Electron.Rectangle,
  isPrimary: boolean
): FeedbackWindow => {
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.setIgnoreMouseEvents(true);
  window.setAlwaysOnTop(true, "screen-saver", 1);
  window.removeMenu();

  return {
    window,
    ready: loadFeedbackPage(key, window),
    bounds: { ...bounds },
    isPrimary,
  };
};

const createSoundWindow = (): FeedbackWindow => {
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

  return {
    window,
    ready: loadFeedbackPage(SOUND_WINDOW_KEY, window),
    bounds: null,
    isPrimary: true,
  };
};

const syncFlashWindows = () => {
  if (isSyncingFlashWindows) return;
  isSyncingFlashWindows = true;

  try {
    const primaryDisplayId = screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays();
    const displayKeys = new Set(displays.map(({ id }) => toDisplayKey(id)));

    for (const [key, { window }] of feedbackWindows) {
      if (displayKeys.has(key)) continue;
      feedbackWindows.delete(key);
      destroyWindow(window);
    }

    for (const display of displays) {
      const key = toDisplayKey(display.id);
      const isPrimary = display.id === primaryDisplayId;
      const existing = feedbackWindows.get(key);

      if (!existing || existing.window.isDestroyed()) {
        if (failedWindowKeys.has(key)) continue;
        feedbackWindows.set(
          key,
          createFlashWindow(key, display.bounds, isPrimary)
        );
        continue;
      }

      existing.isPrimary = isPrimary;
      if (existing.bounds && isSameBounds(existing.bounds, display.bounds)) {
        continue;
      }
      existing.bounds = { ...display.bounds };
      existing.window.setBounds(display.bounds);
    }
  } finally {
    isSyncingFlashWindows = false;
  }
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

const destroyFeedbackWindows = () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  for (const { window } of feedbackWindows.values()) destroyWindow(window);
  feedbackWindows.clear();
  failedWindowKeys.clear();
};

const registerDisplayListeners = () => {
  if (displayListenersRegistered) return;
  displayListenersRegistered = true;

  const onDisplaysChanged = () => {
    if (feedbackWindows.size) syncFlashWindows();
  };

  screen.on("display-added", onDisplaysChanged);
  screen.on("display-removed", onDisplaysChanged);
  screen.on("display-metrics-changed", onDisplaysChanged);
};

const getLiveFeedbackWindows = () =>
  [...feedbackWindows.values()].filter(({ window }) => !window.isDestroyed());

const getToastThumbnailDirectory = async () => {
  const directory = path.join(
    SystemPath.getPath("temp"),
    "hydra-screenshot-toasts"
  );
  await fs.promises.mkdir(directory, { recursive: true });

  const entries = await fs.promises.readdir(directory).catch(() => []);
  if (entries.length > MAX_TOAST_THUMBNAILS) {
    await Promise.all(
      entries.map((entry) =>
        fs.promises.rm(path.join(directory, entry), { force: true })
      )
    );
  }

  return directory;
};

const createToastThumbnail = async (imagePath: string) => {
  const image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) return null;

  const thumbnail = image.resize({
    width: TOAST_THUMBNAIL_WIDTH,
    quality: "good",
  });
  const thumbnailPath = path.join(
    await getToastThumbnailDirectory(),
    `${randomUUID()}.jpeg`
  );
  await fs.promises.writeFile(
    thumbnailPath,
    thumbnail.toJPEG(TOAST_THUMBNAIL_JPEG_QUALITY)
  );

  return { image: thumbnail, path: thumbnailPath };
};

const getToastText = (toast: ScreenshotFeedbackToast) => {
  if (toast.kind === "disabled_for_game") {
    return {
      title: t("disabled_for_game", { ns: "screenshots_capture" }),
      description: toast.gameTitle,
    };
  }

  if (toast.kind === "saved_locally") {
    return {
      title: t("saved_locally", { ns: "screenshots_capture" }),
      description: toast.gameTitle,
    };
  }

  return {
    title: t("captured", { ns: "screenshots_capture" }),
    description: toast.gameTitle,
  };
};

const showOsNotification = (
  title: string,
  body: string,
  notificationIcon: Electron.NativeImage | string
) => {
  try {
    new Notification({
      title,
      body,
      icon: notificationIcon,
      silent: true,
    }).show();
  } catch (error) {
    logger.error("Failed to show the screenshot notification", error);
  }
};

const toLocalUrl = (filePath: string) =>
  `local:${filePath.replaceAll("\\", "/")}`;

export class ScreenshotFeedback {
  public static prepare() {
    if (canShowFlashWindows()) {
      registerDisplayListeners();
      syncFlashWindows();
      return;
    }

    const existing = feedbackWindows.get(SOUND_WINDOW_KEY);
    if (existing && !existing.window.isDestroyed()) return;
    if (failedWindowKeys.has(SOUND_WINDOW_KEY)) return;
    feedbackWindows.set(SOUND_WINDOW_KEY, createSoundWindow());
  }

  public static release() {
    destroyFeedbackWindows();
  }

  public static async playCaptureFeedback(
    override?: Partial<{ flash: boolean; playSound: boolean }>
  ) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    const flash =
      (override?.flash ?? preferences.borderFlashEnabled) &&
      canShowFlashWindows();
    const playSound = override?.playSound ?? preferences.captureSoundEnabled;
    if (!flash && !playSound) return;

    this.prepare();
    const soundUrl = playSound ? await resolveCaptureSoundUrl() : null;
    const volume =
      userPreferences?.achievementSoundVolume ?? DEFAULT_CAPTURE_SOUND_VOLUME;
    await Promise.all(getLiveFeedbackWindows().map(({ ready }) => ready));
    const windows = getLiveFeedbackWindows();

    if (hideTimer) clearTimeout(hideTimer);

    for (const { window, isPrimary } of windows) {
      if (window.isDestroyed()) continue;
      if (flash) window.showInactive();
      const windowSoundUrl = isPrimary ? soundUrl : null;
      window.webContents
        .executeJavaScript(
          `globalThis.hydraScreenshotFeedback(${JSON.stringify(flash)}, ${JSON.stringify(windowSoundUrl)}, ${JSON.stringify(volume)})`
        )
        .catch((error) => {
          logger.error("Failed to play the screenshot feedback", error);
        });
    }

    if (!flash) return;

    hideTimer = setTimeout(() => {
      hideTimer = null;
      for (const { window } of getLiveFeedbackWindows()) window.hide();
    }, FLASH_VISIBLE_DURATION_MS);
  }

  public static async showToast(
    toast: ScreenshotFeedbackToast,
    { ignorePreference = false }: { ignorePreference?: boolean } = {}
  ) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    if (
      !ignorePreference &&
      toast.kind !== "disabled_for_game" &&
      !preferences.toastEnabled
    ) {
      return;
    }

    const { title, description } = getToastText(toast);
    const thumbnail =
      "thumbnailPath" in toast
        ? await createToastThumbnail(toast.thumbnailPath).catch((error) => {
            logger.error(
              "Failed to create the screenshot toast thumbnail",
              error
            );
            return null;
          })
        : null;

    const useCustomNotification =
      process.platform === "win32" &&
      userPreferences?.achievementCustomNotificationsEnabled !== false;

    if (!useCustomNotification) {
      showOsNotification(title, description, thumbnail?.image ?? icon);
      return;
    }

    achievementNotificationPresenter.enqueueScreenshot(
      userPreferences?.achievementCustomNotificationPosition ?? "top-left",
      {
        title,
        description,
        iconUrl: thumbnail ? toLocalUrl(thumbnail.path) : "",
        isHidden: false,
        isRare: false,
        isPlatinum: false,
      },
      () => showOsNotification(title, description, thumbnail?.image ?? icon)
    );
  }
}
