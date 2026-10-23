import fs from "node:fs";
import path from "node:path";
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
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import {
  encodeLinuxGameSessionFrame,
  isWaylandSession,
} from "../linux-game-capture-session";
import {
  resolveGameCaptureSourceId,
  ScreenshotService,
  type GameScreenshotCaptureTarget,
} from "../screenshot";
import { GameContentWarningCache } from "./content-warning-cache";
import { resolveForegroundGame } from "./foreground-game";
import type { ScreenshotGameTarget } from "./foreground-game-match";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { ScreenshotFeedback } from "./screenshot-feedback";
import {
  SCREENSHOT_PREVIEW_MAX_WIDTH,
  type EncodedScreenshotFrame,
} from "./screenshot-frame-script";
import { ScreenshotFrameWorker } from "./screenshot-frame-worker";
import { writeScreenshotPreview } from "./screenshot-preview";
import { isScreenshotsFeatureEnabled } from "./screenshot-feature";
import { resolveManualScreenshotPath } from "./screenshot-file-path";
import { ScreenshotTelemetry } from "./screenshot-telemetry";

const CAPTURE_JPEG_QUALITY = 1;
const FALLBACK_JPEG_QUALITY = 100;
const FALLBACK_PREVIEW_JPEG_QUALITY = 85;
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
  source: ScreenshotTriggerSource;
  ownerId?: string | null;
  previewPath?: string | null;
  playFeedback?: boolean;
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
  source,
  ownerId = getSignedInOwnerId(),
  previewPath = null,
  playFeedback = true,
  extra = {},
}: FinishCaptureOptions) => {
  if (playFeedback) playCaptureFeedback();

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
    previewPath,
    ...extra,
  });

  ScreenshotTelemetry.record("capture", "saved", source);

  void ScreenshotFeedback.showToast({
    kind: ownerId ? "captured" : "saved_locally",
    gameTitle,
    thumbnailPath: previewPath ?? filePath,
  }).catch((error) => {
    logger.error("Failed to show the screenshot toast", error);
  });

  return screenshot;
};

const playCaptureFeedback = () => {
  void ScreenshotFeedback.playCaptureFeedback().catch((error) => {
    logger.error("Failed to play the screenshot capture feedback", error);
  });
};

const encodeNativeImage = (
  image: Electron.NativeImage
): EncodedScreenshotFrame => {
  const { width, height } = image.getSize();
  return {
    width,
    height,
    jpeg: image.toJPEG(FALLBACK_JPEG_QUALITY),
    preview: image
      .resize({ width: Math.min(width, SCREENSHOT_PREVIEW_MAX_WIDTH) })
      .toJPEG(FALLBACK_PREVIEW_JPEG_QUALITY),
    isBlank: false,
  };
};

const acquireFrame = async (
  captureTarget: GameScreenshotCaptureTarget
): Promise<EncodedScreenshotFrame> => {
  if (isWaylandSession() && captureTarget.gameKey) {
    return encodeLinuxGameSessionFrame(captureTarget.gameKey, {
      quality: CAPTURE_JPEG_QUALITY,
      waitForNextFrame: false,
    });
  }

  const sourceId = await resolveGameCaptureSourceId(captureTarget);
  if (sourceId) {
    return ScreenshotFrameWorker.capture(sourceId, {
      quality: CAPTURE_JPEG_QUALITY,
      waitForNextFrame: true,
    });
  }

  return encodeNativeImage(
    await ScreenshotService.captureRawGameImage(captureTarget)
  );
};

const createCaptureTimer = (startedAt: number) => {
  const marks: Record<string, number> = {};
  return {
    mark: (stage: string) => {
      marks[stage] = Math.round(performance.now() - startedAt);
    },
    flush: (gameKey: string | null) => {
      logger.debug("Screenshot capture timings in ms", { gameKey, ...marks });
    },
  };
};

const captureScreenshot = async (
  source: ScreenshotTriggerSource,
  startedAt: number
) => {
  const timer = createCaptureTimer(startedAt);
  const userPreferences = await readUserPreferences();
  const preferences = resolveScreenshotPreferences(userPreferences);
  if (!preferences.enabled) return;
  if (!(await isScreenshotsFeatureEnabled())) return;
  timer.mark("checks");

  const resolved = await resolveForegroundGame({
    allowSingleGameFallback: source === "deeplink",
  });
  timer.mark("foreground");
  if (!resolved) {
    ScreenshotTelemetry.record("capture", "ignored", "no_foreground_game");
    return;
  }

  const { target, foreground } = resolved;
  const gameTitle = resolved.game?.title ?? target.title;
  const warning = getContentWarning(target.shop, target.objectId);
  const capturedAt = new Date();

  let frame: EncodedScreenshotFrame;
  try {
    frame = await acquireFrame({
      processId: target.processId,
      executablePaths: target.executablePaths,
      winePrefixPath: target.winePrefixPath,
      gameKey: target.gameKey,
      windowHandle: foreground?.windowHandle,
      x11WindowId: foreground?.windowId,
    });
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
  timer.mark("frame");

  if (isAdultGameContentWarning(await warning)) {
    await rejectAdultGameCapture(gameTitle);
    return;
  }

  playCaptureFeedback();
  timer.mark("feedback");

  const filePath = await resolveCaptureFilePath(gameTitle, capturedAt);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, frame.jpeg);
  const previewPath = await writeScreenshotPreview(frame.preview).catch(
    (error) => {
      logger.warn("Failed to write the screenshot preview", error);
      return null;
    }
  );
  timer.mark("written");

  await finishCapture({
    target,
    gameTitle,
    filePath,
    capturedAt,
    size: { width: frame.width, height: frame.height },
    defaultVisibility: preferences.defaultVisibility,
    source,
    previewPath,
    playFeedback: false,
  });
  timer.mark("saved");
  timer.flush(target.gameKey);
};

export const handleScreenshotTrigger = async (
  source: ScreenshotTriggerSource
) => {
  const startedAt = performance.now();
  if (captureInProgress) return;
  captureInProgress = true;

  try {
    await captureScreenshot(source, startedAt);
  } catch (error) {
    logger.error("Screenshot capture failed", error);
  } finally {
    captureInProgress = false;
  }
};

export const clearScreenshotGameSession = (gameKey: string) => {
  gameSessionIds.delete(gameKey);
};
