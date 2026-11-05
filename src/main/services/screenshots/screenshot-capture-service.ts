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
  ScreenshotFailureKind,
  ScreenshotFeedbackToast,
  ScreenshotTriggerSource,
} from "@types";

import { getSignedInScreenshotOwnerId } from "./local-screenshot-owner";
import { hasTrackedGamesRunning } from "../game-running-state";
import { logger } from "../logger";
import {
  getSourceClientAreaCrop,
  getSourceWindowSize,
} from "../windows-window-bounds";
import {
  getLinuxGameCaptureFailure,
  getLinuxGameCaptureState,
  grabLinuxGameSessionFrame,
  isWaylandCaptureBackend,
  prepareLinuxGameCaptureSession,
  type LinuxGameCaptureFailure,
} from "../linux-game-capture-session";
import {
  resolveGameCaptureSourceId,
  ScreenshotService,
  type GameScreenshotCaptureTarget,
} from "../screenshot";
import { buildWindowsWindowSourceId } from "../windows-game-window-match";
import { grabDesktopDuplicationFrame } from "./desktop-duplication-frame";
import {
  getUnresolvedGameFailure,
  resolveForegroundGame,
  type ResolvedForegroundGame,
  type UnresolvedForegroundGame,
} from "./foreground-game";
import type { ScreenshotGameTarget } from "./foreground-game-match";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { ScreenshotFeedback } from "./screenshot-feedback";
import {
  BlankScreenshotFrameError,
  SCREENSHOT_PREVIEW_MAX_WIDTH,
  type EncodedScreenshotImages,
  type GrabbedScreenshotFrame,
} from "./screenshot-frame-script";
import { ScreenshotFrameWorker } from "./screenshot-frame-worker";
import {
  removeScreenshotPreview,
  writeScreenshotPreview,
} from "./screenshot-preview";
import { isScreenshotsFeatureEnabled } from "./screenshot-feature";
import { resolveManualScreenshotPath } from "./screenshot-file-path";
import { getScreenshotFolderCandidates } from "./screenshots-folder";
import {
  ensureRootMarkerId,
  getScreenshotsRoot,
} from "./screenshots-root-marker";
import { ScreenshotTelemetry } from "./screenshot-telemetry";
import { readUserPreferences } from "./screenshot-user-preferences";
import { CaptureCallTimeoutError } from "./window-bound-promise";

const DISK_FULL_ERROR_CODES = new Set(["ENOSPC", "EDQUOT"]);
const CAPTURE_JPEG_QUALITY = 0.95;
const FALLBACK_JPEG_QUALITY = 95;
const FALLBACK_PREVIEW_JPEG_QUALITY = 85;
const MAX_FILE_NAME_SUFFIX = 50;
const WAYLAND_SHARE_PROMPT_WAIT_MS = 1_500;

type WaylandShareBlocker = "share_pending" | ScreenshotFailureKind;

const WAYLAND_SHARE_FAILURES: Record<
  LinuxGameCaptureFailure,
  WaylandShareBlocker
> = {
  share_cancelled: "share_pending",
  portal_unavailable: "share_unavailable",
  capture_error: "window_capture_failed",
};

const gameSessionIds = new Map<string, string>();
let captureInProgress = false;
let pendingSaves: Promise<void> = Promise.resolve();

const removePartialScreenshot = async (filePath: string) => {
  await fs.promises.rm(filePath, { force: true }).catch((removeError) => {
    logger.warn("Failed to remove a partially written screenshot", {
      filePath,
      error: removeError,
    });
  });
};

const writeNewScreenshotFile = async (filePath: string, data: Buffer) => {
  const handle = await fs.promises.open(filePath, "wx");
  try {
    await handle.writeFile(data);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await removePartialScreenshot(filePath);
    throw error;
  }
};

const isFileExistsError = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === "EEXIST";

const writeScreenshotToAvailablePath = async (
  screenshotsRoot: string,
  gameTitle: string,
  capturedAt: Date,
  data: Buffer
) => {
  const suffixes: (number | string)[] = [
    ...Array.from({ length: MAX_FILE_NAME_SUFFIX + 1 }, (_, suffix) => suffix),
    randomUUID(),
  ];
  let lastError: unknown = null;
  for (const suffix of suffixes) {
    const filePath = resolveManualScreenshotPath(
      screenshotsRoot,
      gameTitle,
      capturedAt,
      suffix
    );
    try {
      await writeNewScreenshotFile(filePath, data);
      return filePath;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
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

const saveCaptureFile = async (
  gameTitle: string,
  capturedAt: Date,
  data: Buffer
) => {
  let lastError: unknown = null;
  for (const screenshotsRoot of await getScreenshotFolderCandidates()) {
    try {
      await fs.promises.mkdir(
        path.dirname(
          resolveManualScreenshotPath(screenshotsRoot, gameTitle, capturedAt)
        ),
        { recursive: true }
      );
      return await writeScreenshotToAvailablePath(
        screenshotsRoot,
        gameTitle,
        capturedAt,
        data
      );
    } catch (error) {
      logger.warn("Failed to save a screenshot to this folder", {
        screenshotsRoot,
        error: error instanceof Error ? error.message : error,
      });
      lastError = error;
    }
  }

  throw lastError;
};

interface FinishCaptureOptions {
  target: Pick<ScreenshotGameTarget, "gameKey" | "shop" | "objectId">;
  gameTitle: string;
  filePath: string;
  capturedAt: Date;
  size: { width: number; height: number };
  defaultVisibility: ProfileVisibility;
  source: ScreenshotTriggerSource;
  ownerId: string | null;
  previewPath: string | null;
}

const finishCapture = async ({
  target,
  gameTitle,
  filePath,
  capturedAt,
  size,
  defaultVisibility,
  source,
  ownerId,
  previewPath,
}: FinishCaptureOptions) => {
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
    rootMarkerId: await ensureRootMarkerId(getScreenshotsRoot(filePath)),
    previewPath,
  });

  ScreenshotTelemetry.record("capture", "saved", source);

  return screenshot;
};

const discardUnrecordedCapture = async (
  filePath: string,
  previewPath: string | null
) => {
  await Promise.all([
    fs.promises.rm(filePath, { force: true }),
    removeScreenshotPreview(previewPath),
  ]).catch((error) => {
    logger.warn("Failed to remove an unrecorded screenshot", {
      filePath,
      previewPath,
      error,
    });
  });
};

const showCaptureToast = (
  kind: ScreenshotFeedbackToast["kind"],
  gameTitle: string
) => {
  void ScreenshotFeedback.showToast({ kind, gameTitle }).catch((error) => {
    logger.error("Failed to show the screenshot toast", error);
  });
};

const showCaptureFailure = (
  kind: ScreenshotFailureKind,
  gameTitle: string | null
) => {
  void ScreenshotFeedback.showFailureToast({ kind, gameTitle }).catch(
    (error) => {
      logger.error("Failed to show the screenshot failure toast", error);
    }
  );
  void ScreenshotFeedback.playFailureSound().catch((error) => {
    logger.error("Failed to play the screenshot failure sound", error);
  });
};

const getFrameFailureKind = (error: unknown): ScreenshotFailureKind =>
  error instanceof BlankScreenshotFrameError
    ? "blank_frame"
    : "window_capture_failed";

const isDiskFullError = (error: unknown) =>
  DISK_FULL_ERROR_CODES.has(
    (error as NodeJS.ErrnoException | null)?.code ?? ""
  );

const getSaveFailureKind = (
  error: unknown,
  fallback: ScreenshotFailureKind
): ScreenshotFailureKind => (isDiskFullError(error) ? "disk_full" : fallback);

const playCaptureSound = () => {
  void ScreenshotFeedback.playCaptureSound().catch((error) => {
    logger.error("Failed to play the screenshot capture sound", error);
  });
};

const showCapturedToast = (gameTitle: string, ownerId: string | null) => {
  showCaptureToast(ownerId ? "captured" : "saved_locally", gameTitle);
};

const wrapNativeImage = (
  image: Electron.NativeImage
): GrabbedScreenshotFrame => {
  const { width, height } = image.getSize();
  return {
    width,
    height,
    encode: async (): Promise<EncodedScreenshotImages> => ({
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
      waitForNextFrame: false,
      crop: getSourceClientAreaCrop(sourceId),
      expectedSize: getSourceWindowSize(sourceId),
    });
  } catch (error) {
    if (
      error instanceof BlankScreenshotFrameError ||
      error instanceof CaptureCallTimeoutError
    ) {
      throw error;
    }
    logger.warn("Direct window capture failed, resolving the window source", {
      gameKey: captureTarget.gameKey,
      error: error instanceof Error ? error.message : error,
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

  const desktopFrame = await grabDesktopDuplicationFrame(
    captureTarget.windowHandle
  );
  if (desktopFrame) return desktopFrame;

  const directFrame = await grabFromDirectWindowsSource(captureTarget);
  if (directFrame) return directFrame;

  const sourceId = await resolveGameCaptureSourceId(captureTarget);
  if (sourceId) {
    return ScreenshotFrameWorker.grab(sourceId, {
      waitForNextFrame: process.platform !== "win32",
      crop: getSourceClientAreaCrop(sourceId),
      expectedSize: getSourceWindowSize(sourceId),
    });
  }

  return wrapNativeImage(
    await ScreenshotService.captureRawGameImage({
      ...captureTarget,
      cropToClientArea: true,
    })
  );
};

const waitForWaylandSharePrompt = (gameKey: string) =>
  Promise.race([
    prepareLinuxGameCaptureSession(gameKey, "screenshot"),
    new Promise<void>((resolve) => {
      setTimeout(resolve, WAYLAND_SHARE_PROMPT_WAIT_MS);
    }),
  ]);

const getWaylandShareBlocker = async (
  source: ScreenshotTriggerSource,
  gameKey: string
): Promise<WaylandShareBlocker | null> => {
  if (!isWaylandCaptureBackend()) return null;

  const initialState = getLinuxGameCaptureState(gameKey);
  if (initialState === "ready") {
    void prepareLinuxGameCaptureSession(gameKey, "screenshot");
    return null;
  }
  if (initialState === "pending") {
    void prepareLinuxGameCaptureSession(gameKey, "screenshot");
  }
  if (initialState === "failed") {
    await waitForWaylandSharePrompt(gameKey);
  }

  const state = getLinuxGameCaptureState(gameKey);
  if (state === "ready") return null;

  const failure =
    state === "failed" ? getLinuxGameCaptureFailure(gameKey) : null;
  logger.debug("Screenshot hotkey ignored: window share not granted", {
    source,
    gameKey,
    state,
    failure,
  });
  ScreenshotTelemetry.record("capture", "ignored", `share_${failure ?? state}`);
  return failure ? WAYLAND_SHARE_FAILURES[failure] : "share_pending";
};

type CaptureFailureStage = "frame" | "encode" | "write" | "store";

const recordCaptureFailure = (
  gameKey: string,
  stage: CaptureFailureStage,
  error: unknown
) => {
  logger.error("Failed to capture a manual screenshot", {
    gameKey,
    stage,
    error: error instanceof Error ? error.message : error,
  });
  const errorName = error instanceof Error ? error.name : "unknown_error";
  ScreenshotTelemetry.record("capture", "failed", `${stage}_${errorName}`);
};

const createCaptureTimer = (
  startedAt: number,
  source: ScreenshotTriggerSource
) => {
  const marks: Record<string, number> = {};
  return {
    mark: (stage: string) => {
      marks[stage] = Math.round(performance.now() - startedAt);
    },
    flush: (gameKey: string | null) => {
      logger.debug("Screenshot capture timings in ms", {
        gameKey,
        source,
        ...marks,
      });
    },
  };
};

type SaveCapturedScreenshot = () => Promise<void>;

const recordUnexpectedFailure = (error: unknown) => {
  const errorName = error instanceof Error ? error.name : "unknown_error";
  ScreenshotTelemetry.record("capture", "failed", `unexpected_${errorName}`);
};

const reportUnresolvedGame = (
  source: ScreenshotTriggerSource,
  unresolved: UnresolvedForegroundGame,
  toastEnabled: boolean
) => {
  const failure = getUnresolvedGameFailure(source, unresolved);
  if (unresolved.candidates.length) {
    ScreenshotTelemetry.record("capture", "ignored", "no_foreground_game");
  }
  if (failure && toastEnabled) {
    showCaptureFailure(failure.kind, failure.gameTitle);
  }
};

const grabResolvedGame = async (
  resolved: ResolvedForegroundGame,
  source: ScreenshotTriggerSource,
  preferences: ReturnType<typeof resolveScreenshotPreferences>,
  timer: ReturnType<typeof createCaptureTimer>
): Promise<SaveCapturedScreenshot | null> => {
  const { target, foreground } = resolved;
  const gameTitle = resolved.game?.title ?? target.title;
  const capturedAt = new Date();

  const shareBlocker = await getWaylandShareBlocker(source, target.gameKey);
  if (shareBlocker === "share_pending") {
    showCaptureToast(shareBlocker, gameTitle);
    return null;
  }
  if (shareBlocker) {
    showCaptureFailure(shareBlocker, gameTitle);
    return null;
  }

  const ownerId = getSignedInScreenshotOwnerId();

  const failCapture = (
    stage: CaptureFailureStage,
    error: unknown,
    kind: ScreenshotFailureKind
  ) => {
    recordCaptureFailure(target.gameKey, stage, error);
    showCaptureFailure(kind, gameTitle);
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
    failCapture("frame", error, getFrameFailureKind(error));
    return null;
  }
  timer.mark("frame");

  playCaptureSound();
  timer.mark("sound");

  let images: EncodedScreenshotImages;
  try {
    images = await frame.encode(CAPTURE_JPEG_QUALITY);
  } catch (error) {
    failCapture("encode", error, "save_failed");
    return null;
  } finally {
    frame.discard();
  }
  timer.mark("encoded");

  return async () => {
    let filePath: string;
    try {
      filePath = await saveCaptureFile(gameTitle, capturedAt, images.jpeg);
    } catch (error) {
      failCapture(
        "write",
        error,
        getSaveFailureKind(error, "file_write_failed")
      );
      return;
    }
    const previewPath = await writeScreenshotPreview(images.preview).catch(
      (error) => {
        logger.warn("Failed to write the screenshot preview", error);
        return null;
      }
    );
    timer.mark("written");

    try {
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
      });
    } catch (error) {
      failCapture("store", error, getSaveFailureKind(error, "save_failed"));
      await discardUnrecordedCapture(filePath, previewPath);
      return;
    }
    showCapturedToast(gameTitle, ownerId);
    timer.mark("saved");
    timer.flush(target.gameKey);
  };
};

const grabScreenshot = async (
  source: ScreenshotTriggerSource,
  startedAt: number
): Promise<SaveCapturedScreenshot | null> => {
  const timer = createCaptureTimer(startedAt, source);
  const userPreferences = await readUserPreferences();
  const preferences = resolveScreenshotPreferences(userPreferences);
  if (!preferences.enabled) {
    logger.debug("Screenshot hotkey ignored: screenshots disabled", { source });
    return null;
  }
  if (!(await isScreenshotsFeatureEnabled())) {
    logger.debug("Screenshot hotkey ignored: feature flag off", { source });
    return null;
  }
  timer.mark("checks");

  let lookup: Awaited<ReturnType<typeof resolveForegroundGame>>;
  try {
    lookup = await resolveForegroundGame(source);
  } catch (error) {
    logger.error("Failed to resolve the screenshot game", error);
    recordUnexpectedFailure(error);
    if (preferences.toastEnabled && hasTrackedGamesRunning()) {
      showCaptureFailure("unexpected_error", null);
    }
    return null;
  }
  timer.mark("foreground");
  if (lookup.status === "unresolved") {
    reportUnresolvedGame(source, lookup, preferences.toastEnabled);
    return null;
  }

  try {
    return await grabResolvedGame(lookup, source, preferences, timer);
  } catch (error) {
    logger.error("Screenshot capture failed", error);
    recordUnexpectedFailure(error);
    showCaptureFailure("unexpected_error", null);
    return null;
  }
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
  logger.debug("Screenshot trigger received", { source });
  if (captureInProgress) {
    logger.debug("Screenshot hotkey ignored: capture in progress", { source });
    return;
  }
  captureInProgress = true;

  let save: SaveCapturedScreenshot | null = null;
  try {
    save = await grabScreenshot(source, startedAt);
  } catch (error) {
    logger.error("Screenshot trigger failed before capture", error);
  } finally {
    captureInProgress = false;
  }

  if (save) await queueScreenshotSave(save);
};

export const clearScreenshotGameSession = (gameKey: string) => {
  gameSessionIds.delete(gameKey);
};
