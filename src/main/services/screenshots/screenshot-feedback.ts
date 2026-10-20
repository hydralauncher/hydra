import { BrowserWindow, Notification, nativeImage, screen } from "electron";
import { t } from "i18next";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import icon from "@resources/icon.png?asset";
import { db, levelKeys } from "@main/level";
import { resolveScreenshotPreferences } from "@shared";
import type { ScreenshotFeedbackToast, UserPreferences } from "@types";

import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { isWaylandSession } from "../linux-game-capture-session";
import { logger } from "../logger";
import { SystemPath } from "../system-path";
import { WindowManager } from "../window-manager";

const FLASH_VISIBLE_DURATION_MS = 700;
const TOAST_THUMBNAIL_WIDTH = 320;
const MAX_TOAST_THUMBNAILS = 20;

interface FeedbackWindow {
  displayId: number;
  window: BrowserWindow;
  ready: Promise<void>;
}

let feedbackWindows: FeedbackWindow[] = [];
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let displayListenersRegistered = false;

const readUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const canShowFlashWindows = () =>
  (process.platform === "win32" || process.platform === "linux") &&
  !isWaylandSession();

const createFeedbackWindow = (
  display: Electron.Display,
  isPrimary: boolean
) => {
  const window = new BrowserWindow({
    ...display.bounds,
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
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  window.setIgnoreMouseEvents(true);
  window.setAlwaysOnTop(true, "screen-saver", 1);
  window.removeMenu();

  const ready = WindowManager.loadWindowURL(
    window,
    `screenshot-flash?primary=${isPrimary ? "1" : "0"}`
  ).catch((error) => {
    logger.error("Failed to load the screenshot flash window", error);
  });

  return { displayId: display.id, window, ready };
};

const destroyFeedbackWindows = () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  for (const { window } of feedbackWindows) {
    if (!window.isDestroyed()) window.destroy();
  }
  feedbackWindows = [];
};

const registerDisplayListeners = () => {
  if (displayListenersRegistered) return;
  displayListenersRegistered = true;

  const resetWindows = () => {
    if (!feedbackWindows.length) return;
    destroyFeedbackWindows();
    ScreenshotFeedback.prepare();
  };

  screen.on("display-added", resetWindows);
  screen.on("display-removed", resetWindows);
  screen.on("display-metrics-changed", resetWindows);
};

const getLiveFeedbackWindows = () =>
  feedbackWindows.filter(({ window }) => !window.isDestroyed());

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
  await fs.promises.writeFile(thumbnailPath, thumbnail.toJPEG(80));

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
    if (feedbackWindows.length) return;

    registerDisplayListeners();

    if (canShowFlashWindows()) {
      const primaryDisplayId = screen.getPrimaryDisplay().id;
      feedbackWindows = screen
        .getAllDisplays()
        .map((display) =>
          createFeedbackWindow(display, display.id === primaryDisplayId)
        );
      return;
    }

    feedbackWindows = [createFeedbackWindow(screen.getPrimaryDisplay(), true)];
  }

  public static release() {
    destroyFeedbackWindows();
  }

  public static async playCaptureFeedback() {
    const preferences = resolveScreenshotPreferences(
      await readUserPreferences()
    );
    const flash = preferences.borderFlashEnabled && canShowFlashWindows();
    const playSound = preferences.captureSoundEnabled;
    if (!flash && !playSound) return;

    this.prepare();
    const windows = getLiveFeedbackWindows();
    await Promise.all(windows.map(({ ready }) => ready));

    if (hideTimer) clearTimeout(hideTimer);

    for (const { window } of windows) {
      if (window.isDestroyed()) continue;
      if (flash) window.showInactive();
      window.webContents.send("on-screenshot-feedback", { flash, playSound });
    }

    if (!flash) return;

    hideTimer = setTimeout(() => {
      hideTimer = null;
      for (const { window } of getLiveFeedbackWindows()) window.hide();
    }, FLASH_VISIBLE_DURATION_MS);
  }

  public static async showToast(toast: ScreenshotFeedbackToast) {
    const userPreferences = await readUserPreferences();
    const preferences = resolveScreenshotPreferences(userPreferences);
    const isCaptureToast = toast.kind === "captured";
    if (isCaptureToast && !preferences.toastEnabled) return;

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
