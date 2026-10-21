import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { db, levelKeys } from "@main/level";
import {
  isAdultGameContentWarning,
  resolveScreenshotPreferences,
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  UNKNOWN_GAME_CONTENT_WARNING,
} from "@shared";
import type {
  GameContentWarning,
  LocalScreenshot,
  ProfileVisibility,
  ScreenshotTriggerSource,
  UserPreferences,
} from "@types";

import { getAchievementScreenshotsDirectory } from "../achievement-screenshots-directory";
import { emulatorSessions } from "../emulators/emulator-session-tracker";
import { gamesPlaytime } from "../game-running-state";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { ScreenshotService } from "../screenshot";
import { GameContentWarningCache } from "./content-warning-cache";
import { resolveForegroundGame } from "./foreground-game";
import type { ScreenshotGameTarget } from "./foreground-game-match";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { ScreenshotFeedback } from "./screenshot-feedback";
import { isScreenshotsFeatureEnabled } from "./screenshot-feature";
import { resolveManualScreenshotPath } from "./screenshot-file-path";
import { ScreenshotReviewWindows } from "./screenshot-review-windows";
import { ScreenshotTelemetry } from "./screenshot-telemetry";

const CAPTURE_JPEG_QUALITY = 100;
const CONTENT_WARNING_WAIT_MS = 1_500;
const MAX_FILE_NAME_SUFFIX = 50;

const gameSessionIds = new Map<string, string>();
let captureInProgress = false;

const readUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const getContentWarning = async (
  shop: LocalScreenshot["shop"],
  objectId: string
): Promise<GameContentWarning> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<GameContentWarning>((resolve) => {
    timer = setTimeout(
      () => resolve(UNKNOWN_GAME_CONTENT_WARNING),
      CONTENT_WARNING_WAIT_MS
    );
  });

  try {
    return await Promise.race([
      GameContentWarningCache.get(shop, objectId),
      timeout,
    ]);
  } catch {
    return UNKNOWN_GAME_CONTENT_WARNING;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const resolveAvailableFilePath = async (
  screenshotsRoot: string,
  gameTitle: string,
  capturedAt: Date
) => {
  for (let suffix = 0; suffix <= MAX_FILE_NAME_SUFFIX; suffix++) {
    const filePath = resolveManualScreenshotPath(
      screenshotsRoot,
      gameTitle,
      capturedAt,
      suffix
    );
    const exists = await fs.promises
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) return filePath;
  }

  return resolveManualScreenshotPath(
    screenshotsRoot,
    `${gameTitle}-${randomUUID()}`,
    capturedAt
  );
};

const getDefaultCustomGameTitle = (
  shop: LocalScreenshot["shop"],
  gameTitle: string
) => {
  if (shop !== "custom") return null;
  return (
    gameTitle.trim().slice(0, SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH) || null
  );
};

const getGameSessionId = (gameKey: string) => {
  const existing = gameSessionIds.get(gameKey);
  if (existing) return existing;

  const sessionId = randomUUID();
  gameSessionIds.set(gameKey, sessionId);
  return sessionId;
};

export const rejectAdultGameCapture = async (gameTitle: string) => {
  ScreenshotTelemetry.record("capture", "blocked", "adult_game");
  await ScreenshotFeedback.showToast({ kind: "disabled_for_game", gameTitle });
};

export const resolveCaptureFilePath = async (
  gameTitle: string,
  capturedAt: Date
) =>
  resolveAvailableFilePath(
    await getAchievementScreenshotsDirectory(),
    gameTitle,
    capturedAt
  );

export interface FinishCaptureOptions {
  target: Pick<ScreenshotGameTarget, "gameKey" | "shop" | "objectId">;
  gameTitle: string;
  filePath: string;
  capturedAt: Date;
  size: { width: number; height: number };
  defaultVisibility: ProfileVisibility;
  askToUploadAfterGame: boolean;
  source: ScreenshotTriggerSource;
  gameWindowHandle: string | null;
  isGameRunning: () => boolean;
  ownerId?: string | null;
  extra?: Partial<LocalScreenshot>;
}

const getSignedInOwnerId = () =>
  HydraApi.isLoggedIn() ? (HydraApi.getAuthContext()?.userId ?? null) : null;

export const finishCapture = async ({
  target,
  gameTitle,
  filePath,
  capturedAt,
  size,
  defaultVisibility,
  askToUploadAfterGame,
  source,
  gameWindowHandle,
  isGameRunning,
  ownerId = getSignedInOwnerId(),
  extra = {},
}: FinishCaptureOptions) => {
  void ScreenshotFeedback.playCaptureFeedback().catch((error) => {
    logger.error("Failed to play the screenshot capture feedback", error);
  });

  const screenshot = await LocalScreenshotStore.put({
    clientId: randomUUID(),
    ownerId,
    shop: target.shop,
    objectId: target.objectId,
    gameTitle,
    customGameTitle: getDefaultCustomGameTitle(target.shop, gameTitle),
    path: filePath,
    capturedAt: capturedAt.getTime(),
    width: size.width,
    height: size.height,
    state: "local",
    isSpoiler: false,
    visibility: defaultVisibility,
    screenshotId: null,
    moderationStatus: null,
    moderationReason: null,
    uploadProgress: null,
    lastError: null,
    gameSessionId: getGameSessionId(target.gameKey),
    ...extra,
  });

  ScreenshotTelemetry.record("capture", "saved", source);

  void ScreenshotFeedback.showToast({
    kind: ownerId ? "captured" : "saved_locally",
    gameTitle,
    thumbnailPath: filePath,
  }).catch((error) => {
    logger.error("Failed to show the screenshot toast", error);
  });

  if (ownerId && askToUploadAfterGame) {
    await ScreenshotReviewWindows.addCapture({
      screenshot,
      gameKey: target.gameKey,
      gameWindowHandle,
      isGameRunning,
    });
  }

  return screenshot;
};

const captureScreenshot = async (source: ScreenshotTriggerSource) => {
  const userPreferences = await readUserPreferences();
  const preferences = resolveScreenshotPreferences(userPreferences);
  if (!preferences.enabled) return;
  if (!(await isScreenshotsFeatureEnabled())) return;

  const resolved = await resolveForegroundGame({
    allowSingleGameFallback: source === "deeplink",
  });
  if (!resolved) {
    ScreenshotTelemetry.record("capture", "ignored", "no_foreground_game");
    return;
  }

  const { target, foreground } = resolved;
  const gameTitle = resolved.game?.title ?? target.title;

  const warning = await getContentWarning(target.shop, target.objectId);
  if (isAdultGameContentWarning(warning)) {
    await rejectAdultGameCapture(gameTitle);
    return;
  }

  const capturedAt = new Date();
  const filePath = await resolveCaptureFilePath(gameTitle, capturedAt);

  let image: Electron.NativeImage;
  try {
    ({ image } = await ScreenshotService.captureGameImage(
      {
        processId: target.processId,
        executablePaths: target.executablePaths,
        winePrefixPath: target.winePrefixPath,
        gameKey: target.gameKey,
        windowHandle: foreground?.windowHandle,
        x11WindowId: foreground?.windowId,
      },
      { filePath, quality: CAPTURE_JPEG_QUALITY, fitTo1080p: false }
    ));
  } catch (error) {
    logger.error("Failed to capture a manual screenshot", {
      gameKey: target.gameKey,
      error: error instanceof Error ? error.message : String(error),
    });
    ScreenshotTelemetry.record(
      "capture",
      "failed",
      error instanceof Error ? error.name : "unknown_error"
    );
    return;
  }

  await finishCapture({
    target,
    gameTitle,
    filePath,
    capturedAt,
    size: image.getSize(),
    defaultVisibility: preferences.defaultVisibility,
    askToUploadAfterGame: preferences.askToUploadAfterGame,
    source,
    gameWindowHandle: foreground?.windowHandle ?? null,
    isGameRunning: () =>
      gamesPlaytime.has(target.gameKey) || emulatorSessions.has(target.gameKey),
  });
};

export const handleScreenshotTrigger = async (
  source: ScreenshotTriggerSource
) => {
  if (captureInProgress) return;
  captureInProgress = true;

  try {
    await captureScreenshot(source);
  } catch (error) {
    logger.error("Screenshot capture failed", error);
  } finally {
    captureInProgress = false;
  }
};

export const clearScreenshotGameSession = (gameKey: string) => {
  gameSessionIds.delete(gameKey);
};
