import { BrowserWindow, Notification, nativeImage } from "electron";
import { t } from "i18next";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import { SystemPath } from "../system-path";

const DEFAULT_CAPTURE_SOUND_VOLUME = 0.15;
const TOAST_THUMBNAIL_WIDTH = 320;
const TOAST_THUMBNAIL_JPEG_QUALITY = 80;
const MAX_TOAST_THUMBNAILS = 20;

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
    if (soundWindow && !soundWindow.window.isDestroyed()) return;
    if (soundWindowFailed) return;
    soundWindow = createSoundWindow();
  }

  public static release() {
    if (soundWindow) destroyWindow(soundWindow.window);
    soundWindow = null;
    soundWindowFailed = false;
  }

  public static async playCaptureSound({ force = false } = {}) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    if (!force && !preferences.captureSoundEnabled) return;

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
