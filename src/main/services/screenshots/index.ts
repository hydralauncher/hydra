import fs from "node:fs";
import { shell } from "electron";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { resolveScreenshotPreferences } from "@shared";
import type {
  GameShop,
  LocalScreenshotUploadOptions,
  UserPreferences,
} from "@types";

import { getAchievementScreenshotsDirectory } from "../achievement-screenshots-directory";
import { emulatorSessions } from "../emulators/emulator-session-tracker";
import { gamesPlaytime } from "../game-running-state";
import {
  isWaylandSession,
  prepareLinuxGameCaptureSession,
  stopAllLinuxGameCaptureSessions,
} from "../linux-game-capture-session";
import { logger } from "../logger";
import { ScreenshotInputService } from "../screenshot-input";
import { WindowManager } from "../window-manager";
import { GameContentWarningCache } from "./content-warning-cache";
import { LocalScreenshotStore } from "./local-screenshot-store";
import {
  clearScreenshotGameSession,
  handleScreenshotTrigger,
} from "./screenshot-capture-service";
import { ScreenshotFeedback } from "./screenshot-feedback";
import { isScreenshotsFeatureEnabled } from "./screenshot-feature";
import { getManualScreenshotsDirectory } from "./screenshot-file-path";
import { ScreenshotReviewWindows } from "./screenshot-review-windows";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { ScreenshotUploadNotifier } from "./screenshot-upload-notifier";
import { screenshotUploadWorker } from "./screenshot-upload-worker";

export { LocalScreenshotStore } from "./local-screenshot-store";
export { screenshotUploadWorker } from "./screenshot-upload-worker";
export { ScreenshotReviewWindows } from "./screenshot-review-windows";

const SCREENSHOTS_MODULE_LOADED_AT = Date.now();

let initialized = false;

const readUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const isScreenshotCaptureAvailable = async () => {
  const preferences = resolveScreenshotPreferences(await readUserPreferences());
  return preferences.enabled && (await isScreenshotsFeatureEnabled());
};

const hasRunningGames = () =>
  gamesPlaytime.size > 0 || emulatorSessions.size > 0;

export const initializeScreenshots = () => {
  if (initialized) return;
  initialized = true;

  ScreenshotInputService.onTrigger((source) => {
    void handleScreenshotTrigger(source);
  });

  LocalScreenshotStore.onChange((screenshots) => {
    WindowManager.sendToAppWindows("on-local-screenshots-change", screenshots);
    ScreenshotReviewWindows.broadcast(
      "on-local-screenshots-change",
      screenshots
    );
  });

  ScreenshotReviewWindows.onWindowClosed(() => {
    void ScreenshotUploadNotifier.refresh();
  });

  void ScreenshotReviewWindows.releaseStaleReviews(SCREENSHOTS_MODULE_LOADED_AT)
    .catch((error) => {
      logger.error("Failed to release stale screenshot reviews", error);
    })
    .finally(() => screenshotUploadWorker.start());
};

export const onScreenshotGameStarted = async (
  gameKey: string,
  shop: GameShop,
  objectId: string
) => {
  try {
    void GameContentWarningCache.prefetch(shop, objectId).catch(() => null);
    if (!(await isScreenshotCaptureAvailable())) return;

    ScreenshotFeedback.prepare();
    if (isWaylandSession()) {
      void prepareLinuxGameCaptureSession(gameKey, "screenshot");
    }
  } catch (error) {
    logger.error("Failed to prepare screenshots for a running game", error);
  }
};

export const onScreenshotGameClosed = (gameKey: string) => {
  clearScreenshotGameSession(gameKey);
  void ScreenshotReviewWindows.onGameClosed(gameKey).catch((error) => {
    logger.error("Failed to show the screenshot review windows", error);
  });

  if (!hasRunningGames()) ScreenshotFeedback.release();
};

export const applyScreenshotsEnabledPreference = async (
  enabled: boolean | undefined
) => {
  if (enabled === false) {
    stopAllLinuxGameCaptureSessions("screenshot");
    ScreenshotFeedback.release();
    return;
  }

  if (!hasRunningGames()) return;

  const runningGameKeys = new Set([
    ...gamesPlaytime.keys(),
    ...emulatorSessions.keys(),
  ]);
  for (const gameKey of runningGameKeys) {
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (game) await onScreenshotGameStarted(gameKey, game.shop, game.objectId);
  }
};

export const getLocalScreenshots = () => LocalScreenshotStore.list();

export const flushScreenshotTelemetry = (timeoutMs: number) =>
  Promise.race([
    ScreenshotTelemetry.flush(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs).unref?.();
    }),
  ]);

export const uploadLocalScreenshot = async (
  clientId: string,
  options: LocalScreenshotUploadOptions,
  sender?: Electron.WebContents
) => {
  const isReviewOrigin =
    !!sender &&
    (ScreenshotReviewWindows.isReviewWindowSender(sender) ||
      WindowManager.bigPictureWindow?.webContents === sender);
  if (isReviewOrigin) ScreenshotUploadNotifier.markReviewOrigin(clientId);

  return screenshotUploadWorker.enqueue(clientId, options);
};

export const deleteLocalScreenshot = async (clientId: string) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot) return;

  screenshotUploadWorker.cancel(clientId);
  await fs.promises.rm(screenshot.path, { force: true });
  await LocalScreenshotStore.delete(clientId);
  ScreenshotReviewWindows.removeScreenshotFromWindows(clientId);
  ScreenshotTelemetry.record("review", "delete");
};

export const openScreenshotReview = async (clientId: string) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot) return;
  await ScreenshotReviewWindows.openForScreenshot(screenshot);
};

export const skipLocalScreenshot = async (clientId: string) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot) return;

  if (screenshot.state === "reviewing") {
    await LocalScreenshotStore.update(clientId, { state: "local" });
  }
  ScreenshotReviewWindows.removeScreenshotFromWindows(clientId);
  ScreenshotTelemetry.record("review", "skip");
};

export const openScreenshotsFolder = async () => {
  const directory = getManualScreenshotsDirectory(
    await getAchievementScreenshotsDirectory()
  );
  await fs.promises.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) logger.error("Failed to open the screenshots folder", error);
};

export const getScreenshotsFolderPath = async () =>
  getManualScreenshotsDirectory(await getAchievementScreenshotsDirectory());
