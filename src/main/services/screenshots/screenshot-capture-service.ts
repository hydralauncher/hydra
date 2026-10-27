import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  resolveScreenshotPreferences,
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
} from "@shared";
import type {
  LocalScreenshot,
  ProfileVisibility,
  ScreenshotTriggerSource,
} from "@types";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { getSourceClientAreaCrop } from "../windows-window-bounds";
import {
  grabLinuxGameSessionFrame,
  isWaylandCaptureBackend,
} from "../linux-game-capture-session";
import {
  resolveGameCaptureSourceId,
  ScreenshotService,
  type GameScreenshotCaptureTarget,
} from "../screenshot";
import { buildWindowsWindowSourceId } from "../windows-game-window-match";
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
import { getScreenshotsFolder } from "./screenshots-folder";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { readUserPreferences } from "./screenshot-user-preferences";

const CAPTURE_JPEG_QUALITY = 0.95;
const FALLBACK_JPEG_QUALITY = 95;
const FALLBACK_PREVIEW_JPEG_QUALITY = 85;
const MAX_FILE_NAME_SUFFIX = 50;

const gameSessionIds = new Map<string, string>();
let captureInProgress = false;
let pendingSaves: Promise<void> = Promise.resolve();

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

const resolveCaptureFilePath = async (gameTitle: string, capturedAt: Date) =>
  resolveAvailableFilePath(await getScreenshotsFolder(), gameTitle, capturedAt);

interface FinishCaptureOptions {
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
}

const getSignedInOwnerId = () =>
  HydraApi.isLoggedIn() ? (HydraApi.getAuthContext()?.userId ?? null) : null;

const finishCapture = async ({
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

const playCaptureSound = () => {
  void ScreenshotFeedback.playCaptureSound().catch((error) => {
    logger.error("Failed to play the screenshot capture sound", error);
  });
};

const showCapturedToast = (gameTitle: string, ownerId: string | null) => {
  showCaptureToast(ownerId ? "captured" : "saved_locally", gameTitle);
};

const announceCapture = (gameTitle: string, ownerId: string | null) => {
  playCaptureSound();
  showCapturedToast(gameTitle, ownerId);
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
      crop: getSourceClientAreaCrop(sourceId),
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
  if (isWaylandCaptureBackend() && captureTarget.gameKey) {
    return grabLinuxGameSessionFrame(captureTarget.gameKey, {
      waitForNextFrame: false,
    });
  }

  const directFrame = await grabFromDirectWindowsSource(captureTarget);
  if (directFrame) return directFrame;

  const sourceId = await resolveGameCaptureSourceId(captureTarget);
  if (sourceId) {
    return ScreenshotFrameWorker.grab(sourceId, {
      waitForNextFrame: true,
      crop: getSourceClientAreaCrop(sourceId),
    });
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

type SaveCapturedScreenshot = () => Promise<void>;

const grabScreenshot = async (
  source: ScreenshotTriggerSource,
  startedAt: number
): Promise<SaveCapturedScreenshot | null> => {
  const timer = createCaptureTimer(startedAt);
  const userPreferences = await readUserPreferences();
  const preferences = resolveScreenshotPreferences(userPreferences);
  if (!preferences.enabled) return null;
  if (!(await isScreenshotsFeatureEnabled())) return null;
  timer.mark("checks");

  const resolved = await resolveForegroundGame(source);
  timer.mark("foreground");
  if (!resolved) {
    ScreenshotTelemetry.record("capture", "ignored", "no_foreground_game");
    return null;
  }

  const { target, foreground } = resolved;
  const gameTitle = resolved.game?.title ?? target.title;
  const capturedAt = new Date();

  const ownerId = getSignedInOwnerId();
  playCaptureSound();
  timer.mark("sound");

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
    return null;
  }
  timer.mark("frame");

  showCapturedToast(gameTitle, ownerId);

  let images: EncodedScreenshotImages;
  try {
    images = await frame.encode(CAPTURE_JPEG_QUALITY);
  } catch (error) {
    failCapture(error);
    return null;
  } finally {
    frame.discard();
  }
  timer.mark("encoded");

  return async () => {
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
};

const queueScreenshotSave = (save: SaveCapturedScreenshot) => {
  const queued = pendingSaves.then(save).catch((error) => {
    logger.error("Failed to save a captured screenshot", error);
  });
  pendingSaves = queued;
  return queued;
};

export const handleScreenshotTrigger = async (
  source: ScreenshotTriggerSource
) => {
  const startedAt = performance.now();
  if (captureInProgress) return;
  captureInProgress = true;

  let save: SaveCapturedScreenshot | null = null;
  try {
    save = await grabScreenshot(source, startedAt);
  } catch (error) {
    logger.error("Screenshot capture failed", error);
  } finally {
    captureInProgress = false;
  }

  if (save) await queueScreenshotSave(save);
};

export const clearScreenshotGameSession = (gameKey: string) => {
  gameSessionIds.delete(gameKey);
};
