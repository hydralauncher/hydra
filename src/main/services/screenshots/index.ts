import fs from "node:fs";
import { shell } from "electron";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { resolveScreenshotPreferences } from "@shared";
import type {
  GameShop,
  LocalScreenshotDraft,
  LocalScreenshotUploadOptions,
  UserPreferences,
} from "@types";

import { emulatorSessions } from "../emulators/emulator-session-tracker";
import { gamesPlaytime } from "../game-running-state";
import {
  isWaylandCaptureBackend,
  prepareLinuxGameCaptureSession,
  stopAllLinuxGameCaptureSessions,
} from "../linux-game-capture-session";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { ScreenshotInputService } from "../screenshot-input";
import { WindowManager } from "../window-manager";
import { GameContentWarningCache } from "./content-warning-cache";
import { forgetForegroundGame } from "./foreground-game";
import { LocalScreenshotStore } from "./local-screenshot-store";
import {
  pruneMissingLocalScreenshots,
  removeLocalScreenshotIfMissing,
} from "./local-screenshot-removal";
import {
  findLocalScreenshotGameObjectId,
  getPublishedScreenshotIds,
} from "./local-screenshot-game";
import { buildLocalScreenshotDraftPatch } from "./screenshot-draft";
import {
  clearScreenshotGameSession,
  handleScreenshotTrigger,
} from "./screenshot-capture-service";
import { ScreenshotFeedback } from "./screenshot-feedback";
import { ScreenshotFrameWorker } from "./screenshot-frame-worker";
import { isScreenshotsFeatureEnabled } from "./screenshot-feature";
import { getScreenshotsFolder } from "./screenshots-folder";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { ScreenshotUploadNotifier } from "./screenshot-upload-notifier";
import { screenshotUploadWorker } from "./screenshot-upload-worker";

export { LocalScreenshotStore } from "./local-screenshot-store";
export { screenshotUploadWorker } from "./screenshot-upload-worker";

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

const releaseStaleReviews = async (startedAt: number) => {
  const screenshots = await LocalScreenshotStore.list();
  await Promise.all(
    screenshots
      .filter(
        (screenshot) =>
          screenshot.state === "reviewing" && screenshot.capturedAt < startedAt
      )
      .map(({ clientId }) =>
        LocalScreenshotStore.update(clientId, (current) =>
          current.state === "reviewing" ? { state: "local" } : {}
        )
      )
  );
};

export const initializeScreenshots = () => {
  if (initialized) return;
  initialized = true;

  ScreenshotInputService.onTrigger((source) => {
    void handleScreenshotTrigger(source);
  });

  LocalScreenshotStore.onChange((screenshots) => {
    WindowManager.sendToAppWindows("on-local-screenshots-change", screenshots);
  });

  screenshotUploadWorker.onMissingFile(removeLocalScreenshotIfMissing);

  void backfillLocalScreenshotGameIds().catch((error) => {
    logger.error("Failed to back-fill local screenshot game ids", error);
  });

  void releaseStaleReviews(SCREENSHOTS_MODULE_LOADED_AT)
    .catch((error) => {
      logger.error("Failed to release stale screenshot reviews", error);
    })
    .finally(() => screenshotUploadWorker.start());
};

const releaseRunningGameResources = () => {
  ScreenshotFeedback.release();
  ScreenshotFrameWorker.release();
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
    void ScreenshotFeedback.prepareToast().catch((error) => {
      logger.error("Failed to prepare the screenshot toast", error);
    });
    if (isWaylandCaptureBackend()) {
      void prepareLinuxGameCaptureSession(gameKey, "screenshot");
    } else if (process.platform === "win32" || process.platform === "linux") {
      ScreenshotFrameWorker.prepare();
    }
  } catch (error) {
    logger.error("Failed to prepare screenshots for a running game", error);
  }
};

export const onScreenshotGameClosed = (gameKey: string) => {
  clearScreenshotGameSession(gameKey);
  forgetForegroundGame(gameKey);
  if (!hasRunningGames()) releaseRunningGameResources();
};

export const applyScreenshotsEnabledPreference = async (
  enabled: boolean | undefined
) => {
  if (enabled === false) {
    stopAllLinuxGameCaptureSessions("screenshot");
    releaseRunningGameResources();
    return;
  }

  if (!hasRunningGames()) return;

  const runningGameKeys = new Set([
    ...gamesPlaytime.keys(),
    ...emulatorSessions.keys(),
  ]);
  await Promise.all(
    [...runningGameKeys].map(async (gameKey) => {
      const game = await gamesSublevel.get(gameKey).catch(() => null);
      if (game) {
        await onScreenshotGameStarted(gameKey, game.shop, game.objectId);
      }
    })
  );
};

export const getLocalScreenshots = async () =>
  pruneMissingLocalScreenshots(await LocalScreenshotStore.list());

export const getLocalScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) =>
  pruneMissingLocalScreenshots(
    await LocalScreenshotStore.listForGame(shop, objectId)
  );

export const getScreenshotsFolderPath = () => getScreenshotsFolder();

export const getPublishedScreenshotIdsForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const ownerId = HydraApi.getAuthContext()?.userId;
  if (!ownerId) return [];
  const screenshots = await LocalScreenshotStore.listIncludingDeleted();
  return getPublishedScreenshotIds(screenshots, shop, objectId, ownerId);
};

const backfillLocalScreenshotGameIds = async () => {
  const screenshots = await LocalScreenshotStore.listIncludingDeleted();
  if (!screenshots.some((screenshot) => !screenshot.objectId)) return;

  const games = await gamesSublevel.values().all();
  const updates = screenshots.flatMap((screenshot) => {
    const objectId = findLocalScreenshotGameObjectId(screenshot, games);
    return objectId ? [{ clientId: screenshot.clientId, objectId }] : [];
  });

  await Promise.all(
    updates.map(({ clientId, objectId }) =>
      LocalScreenshotStore.update(clientId, (current) =>
        current.objectId ? {} : { objectId }
      )
    )
  );
};

export const flushScreenshotTelemetry = (timeoutMs: number) =>
  Promise.race([
    ScreenshotTelemetry.flush(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs).unref?.();
    }),
  ]);

export const uploadLocalScreenshot = async (
  clientId: string,
  options: LocalScreenshotUploadOptions
) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (screenshot && (await removeLocalScreenshotIfMissing(clientId))) {
    return { ...screenshot, state: "deleted" as const };
  }

  ScreenshotUploadNotifier.markUserUpload(clientId);

  return screenshotUploadWorker.enqueue(clientId, options);
};

export {
  countLocalScreenshotFilesForGame,
  deleteLocalScreenshot,
  deleteLocalScreenshotsForGame,
  forgetPublishedScreenshots,
} from "./local-screenshot-removal";

export const updateLocalScreenshotDraft = (
  clientId: string,
  draft: LocalScreenshotDraft
) =>
  LocalScreenshotStore.update(clientId, (current) =>
    buildLocalScreenshotDraftPatch(current, draft)
  );

export const openScreenshotsFolder = async () => {
  const directory = await getScreenshotsFolder();
  await fs.promises.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) logger.error("Failed to open the screenshots folder", error);
};
