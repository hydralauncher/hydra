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
  grabLinuxGameSessionFrame,
  isWaylandSession,
} from "../linux-game-capture-session";
import {
  resolveGameCaptureSourceId,
  ScreenshotService,
  type GameScreenshotCaptureTarget,
} from "../screenshot";
import { buildWindowsWindowSourceId } from "../windows-game-window-match";
import { GameContentWarningCache } from "./content-warning-cache";
import { resolveForegroundGame } from "./foreground-game";
import type { ScreenshotGameTarget } from "./foreground-game-match";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { ScreenshotFeedback } from "./screenshot-feedback";
import {
  SCREENSHOT_PREVIEW_MAX_WIDTH,
  type EncodedScreenshotImages,
  type GrabbedScreenshotFrame,
} from "./screenshot-frame-script";
import {
  BlankScreenshotFrameError,
  ScreenshotFrameWorker,
} from "./screenshot-frame-worker";
import { writeScreenshotPreview } from "./screenshot-preview";
import { isScreenshotsFeatureEnabled } from "./screenshot-feature";
import { resolveManualScreenshotPath } from "./screenshot-file-path";
import { ScreenshotTelemetry } from "./screenshot-telemetry";

const CAPTURE_JPEG_QUALITY = 0.95;
const FALLBACK_JPEG_QUALITY = 95;
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
  announce?: boolean;
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
  announce = true,
  extra = {},
}: FinishCaptureOptions) => {
  if (announce) announceCapture(gameTitle, ownerId);

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

  return screenshot;
};

const showCaptureToast = (
  kind: "captured" | "saved_locally" | "capture_failed",
  gameTitle: string
) => {
  void ScreenshotFeedback.showToast({ kind, gameTitle }).catch((error) => {
    logger.error("Failed to show the screenshot toast", error);
  });
};

const announceCapture = (gameTitle: string, ownerId: string | null) => {
  void ScreenshotFeedback.playCaptureSound().catch((error) => {
    logger.error("Failed to play the screenshot capture sound", error);
  });
  showCaptureToast(ownerId ? "captured" : "saved_locally", gameTitle);
};

const wrapNativeImage = (
  image: Electron.NativeImage
): GrabbedScreenshotFrame => {
  const { width, height } = image.getSize();
  return {
    width,
    height,
    encode: async () => ({
      jpeg: image.toJPEG(FALLBACK_JPEG_QUALITY),
      preview: image
        .resize({ width: Math.min(width, SCREENSHOT_PREVIEW_MAX_WIDTH) })
        .toJPEG(FALLBACK_PREVIEW_JPEG_QUALITY),
    }),
    discard: () => {},
  };
};

const grabFromDirectWindowsSource = async (
  captureTarget: GameScreenshotCaptureTarget
) => {
  if (process.platform !== "win32" || !captureTarget.windowHandle) return null;

  const sourceId = buildWindowsWindowSourceId(captureTarget.windowHandle);
  if (!sourceId) return null;

  try {
    return await ScreenshotFrameWorker.grab(sourceId, {
      waitForNextFrame: true,
    });
  } catch (error) {
    if (error instanceof BlankScreenshotFrameError) throw error;
    logger.warn("Direct window capture failed, resolving the window source", {
      gameKey: captureTarget.gameKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const acquireFrame = async (
  captureTarget: GameScreenshotCaptureTarget
): Promise<GrabbedScreenshotFrame> => {
  if (isWaylandSession() && captureTarget.gameKey) {
    return grabLinuxGameSessionFrame(captureTarget.gameKey, {
      waitForNextFrame: false,
    });
  }

  const directFrame = await grabFromDirectWindowsSource(captureTarget);
  if (directFrame) return directFrame;

  const sourceId = await resolveGameCaptureSourceId(captureTarget);
  if (sourceId) {
    return ScreenshotFrameWorker.grab(sourceId, { waitForNextFrame: true });
  }

  return wrapNativeImage(
    await ScreenshotService.captureRawGameImage(captureTarget)
  );
};

const recordCaptureFailure = (gameKey: string, error: unknown) => {
  logger.error("Failed to capture a manual screenshot", {
    gameKey,
    error: error instanceof Error ? error.message : String(error),
  });
  ScreenshotTelemetry.record(
    "capture",
    "failed",
    error instanceof Error ? error.name : "unknown_error"
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
  const capturedAt = new Date();

  if (
    isAdultGameContentWarning(
      await getContentWarning(target.shop, target.objectId)
    )
  ) {
    await rejectAdultGameCapture(gameTitle);
    return;
  }

  const ownerId = getSignedInOwnerId();
  announceCapture(gameTitle, ownerId);
  timer.mark("feedback");

  const failCapture = (error: unknown) => {
    recordCaptureFailure(target.gameKey, error);
    showCaptureToast("capture_failed", gameTitle);
  };

  let frame: GrabbedScreenshotFrame;
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
    failCapture(error);
    return;
  }
  timer.mark("frame");

  let images: EncodedScreenshotImages;
  try {
    images = await frame.encode(CAPTURE_JPEG_QUALITY);
  } catch (error) {
    failCapture(error);
    return;
  } finally {
    frame.discard();
  }
  timer.mark("encoded");

  let filePath: string;
  try {
    filePath = await resolveCaptureFilePath(gameTitle, capturedAt);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, images.jpeg);
  } catch (error) {
    failCapture(error);
    return;
  }
  const previewPath = await writeScreenshotPreview(images.preview).catch(
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
    ownerId,
    previewPath,
    announce: false,
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
