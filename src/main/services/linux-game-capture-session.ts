import { app, BrowserWindow, desktopCapturer, nativeImage } from "electron";
import type { UserPreferences } from "@types";
import {
  isAchievementSouvenirsEnabled,
  resolveScreenshotPreferences,
} from "@shared";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { gamesSublevel } from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import {
  buildGrabFrameExpression,
  createGrabbedFrame,
  parseGrabbedFrame,
  SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS,
  type GrabbedScreenshotFrame,
  type ScreenshotFrameGrabOptions,
} from "./screenshots/screenshot-frame-script";
import {
  addCaptureSessionReason,
  removeCaptureSessionReason,
  type CaptureSessionReason,
} from "./linux-game-capture-session-reasons";
import { readUserPreferences } from "./screenshots/screenshot-user-preferences";
import { isScreenCastPortalAvailable } from "./screencast-portal";
import {
  executeWhileWindowAlive,
  executeWithinDeadline,
} from "./screenshots/window-bound-promise";

export type LinuxGameCaptureState = "pending" | "ready" | "failed";

export type LinuxGameCaptureFailure =
  | "share_cancelled"
  | "portal_unavailable"
  | "capture_error";

interface CaptureSessionRegistration {
  token: object;
  state: LinuxGameCaptureState;
  failure: LinuxGameCaptureFailure | null;
  shareKey: string | null;
  window: BrowserWindow | null;
  subscriptionTimer: ReturnType<typeof setInterval> | null;
  preparation: Promise<void>;
  reasons: Set<CaptureSessionReason>;
  activeCaptures: Set<Promise<unknown>>;
}

const sessions = new Map<string, CaptureSessionRegistration>();
const CAPTURE_TEARDOWN_DELAY_MS = 1_000;
const CAPTURE_PREPARATION_WAIT_MS = 1_500;
const UNCLASSIFIED_PREPARATION_FAILURE: LinuxGameCaptureFailure =
  "capture_error";

const isReasonEligible = (
  reason: CaptureSessionReason,
  userPreferences: UserPreferences | null
) => {
  if (reason === "screenshot") {
    return resolveScreenshotPreferences(userPreferences).enabled;
  }

  return (
    HydraApi.hasActiveSubscription() &&
    isAchievementSouvenirsEnabled(
      userPreferences?.enableAchievementSouvenirs,
      process.platform
    )
  );
};

export const isWaylandSession = () =>
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

export const isWaylandCaptureBackend = () => {
  if (!isWaylandSession()) return false;

  const forcedPlatform = app.commandLine
    .getSwitchValue("ozone-platform")
    .toLowerCase();
  if (forcedPlatform) return forcedPlatform === "wayland";

  return Boolean(process.env.WAYLAND_DISPLAY);
};

interface SharedCaptureWindow {
  window: BrowserWindow;
  users: Set<object>;
}

const sharedCaptures = new Map<string, SharedCaptureWindow>();
const pendingSharedCaptures = new Map<string, Promise<SharedCaptureWindow>>();

const CAPTURE_CLOSED_MESSAGE = "Wayland game window capture session was closed";
const STREAM_ENDED_MESSAGE = "Wayland screen stream is no longer active";
const SERIALIZED_STREAM_ENDED_MESSAGE = JSON.stringify(STREAM_ENDED_MESSAGE);

const isStreamEndedError = (error: unknown) =>
  error instanceof Error && error.message.includes(STREAM_ENDED_MESSAGE);

const closeCaptureWindowIfStreamEnded = (
  captureWindow: BrowserWindow,
  error: unknown
) => {
  if (!isStreamEndedError(error) || captureWindow.isDestroyed()) return;
  logger.warn("Wayland screen stream ended, closing the capture window");
  captureWindow.destroy();
};

const executeInCaptureWindow = (
  captureWindow: BrowserWindow,
  expression: string
) => executeWhileWindowAlive(captureWindow, CAPTURE_CLOSED_MESSAGE, expression);

const captureFrameInWindow = (
  captureWindow: BrowserWindow,
  expression: string
) =>
  executeWithinDeadline(
    captureWindow,
    CAPTURE_CLOSED_MESSAGE,
    expression,
    SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS,
    () => {
      logger.warn("Wayland game window capture timed out, closing it", {
        timeoutMs: SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS,
      });
      if (!captureWindow.isDestroyed()) captureWindow.destroy();
    }
  );

const destroyCaptureWindow = (captureWindow: BrowserWindow | null) => {
  if (!captureWindow || captureWindow.isDestroyed()) return;

  void executeInCaptureWindow(
    captureWindow,
    "globalThis.__hydraSouvenirStream?.getTracks().forEach((track) => track.stop())"
  )
    .catch(() => {})
    .finally(() => {
      setTimeout(() => {
        if (!captureWindow.isDestroyed()) captureWindow.destroy();
      }, CAPTURE_TEARDOWN_DELAY_MS);
    });
};

const createCaptureWindow = async (sourceId: string) => {
  const captureWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try {
    captureWindow.setSkipTaskbar(true);
    await captureWindow.loadFile(capturePagePath);

    const serializedSourceId = JSON.stringify(sourceId);
    await executeInCaptureWindow(
      captureWindow,
      `
      (async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("MediaDevices is unavailable in the Wayland capture page");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: ${serializedSourceId},
              maxFrameRate: 5
            }
          }
        });
        const video = document.querySelector("video");
        video.srcObject = stream;
        await video.play();
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await new Promise((resolve, reject) => {
            video.addEventListener("loadeddata", resolve, { once: true });
            video.addEventListener("error", reject, { once: true });
          });
        }
        stream.getVideoTracks()[0]?.addEventListener(
          "ended",
          () => window.close(),
          { once: true }
        );
        globalThis.__hydraSouvenirStream = stream;
        globalThis.__hydraSouvenirVideo = video;
      })()
    `
    );

    return captureWindow;
  } catch (error) {
    if (!captureWindow.isDestroyed()) captureWindow.destroy();
    throw error;
  }
};

class WindowShareNotSelectedError extends Error {
  constructor(cause?: unknown) {
    super("No Wayland game window capture source was selected", { cause });
    this.name = "WindowShareNotSelectedError";
  }
}

const pickGameWindowSource = async () => {
  const sources = await desktopCapturer
    .getSources({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
    })
    .catch((error) => {
      throw new WindowShareNotSelectedError(error);
    });
  const source = sources.length === 1 ? sources[0] : null;

  if (!source?.id.startsWith("window:")) {
    throw new WindowShareNotSelectedError();
  }

  return source.id;
};

const classifyPreparationFailure = async (
  error: unknown
): Promise<LinuxGameCaptureFailure> => {
  if (!(error instanceof WindowShareNotSelectedError)) return "capture_error";
  return (await isScreenCastPortalAvailable()) === false
    ? "portal_unavailable"
    : "share_cancelled";
};

const getCaptureShareKey = async (gameKey: string) => {
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  return game?.executablePath || gameKey;
};

const openSharedCapture = async (shareKey: string) => {
  const capture: SharedCaptureWindow = {
    window: await createCaptureWindow(await pickGameWindowSource()),
    users: new Set(),
  };
  sharedCaptures.set(shareKey, capture);
  capture.window.once("closed", () => {
    if (sharedCaptures.get(shareKey) === capture) {
      sharedCaptures.delete(shareKey);
    }
  });
  return capture;
};

const getPendingSharedCapture = (shareKey: string) => {
  const pending = pendingSharedCaptures.get(shareKey);
  if (pending !== undefined) return pending;

  const opening = openSharedCapture(shareKey).finally(() => {
    pendingSharedCaptures.delete(shareKey);
  });
  pendingSharedCaptures.set(shareKey, opening);
  return opening;
};

const acquireCaptureWindow = async (shareKey: string, user: object) => {
  const existing = sharedCaptures.get(shareKey);
  const capture =
    existing && !existing.window.isDestroyed()
      ? existing
      : await getPendingSharedCapture(shareKey);
  capture.users.add(user);
  return capture.window;
};

const releaseCaptureWindow = (shareKey: string, user: object) => {
  const capture = sharedCaptures.get(shareKey);
  if (!capture?.users.delete(user) || capture.users.size) return;

  sharedCaptures.delete(shareKey);
  destroyCaptureWindow(capture.window);
};

export const prepareLinuxGameCaptureSession = async (
  gameKey: string,
  reason: CaptureSessionReason = "souvenir"
) => {
  if (!isWaylandCaptureBackend()) return;
  if (reason === "souvenir" && !HydraApi.hasActiveSubscription()) return;

  const failed = sessions.get(gameKey);
  const retriedReasons =
    failed?.state === "failed" && reason === "screenshot"
      ? failed.reasons
      : null;
  if (retriedReasons) sessions.delete(gameKey);

  const existing = sessions.get(gameKey);
  if (existing) {
    const userPreferences = await readUserPreferences();
    if (sessions.get(gameKey) !== existing) return;
    if (isReasonEligible(reason, userPreferences)) {
      existing.reasons = addCaptureSessionReason(existing.reasons, reason);
    }
    return;
  }

  const token = {};
  const registration: CaptureSessionRegistration = {
    token,
    state: "pending",
    failure: null,
    shareKey: null,
    window: null,
    subscriptionTimer: null,
    preparation: Promise.resolve(),
    reasons: addCaptureSessionReason(retriedReasons ?? new Set(), reason),
    activeCaptures: new Set(),
  };

  registration.preparation = (async () => {
    const userPreferences = await readUserPreferences();

    registration.reasons = new Set(
      [...registration.reasons].filter((candidate) =>
        isReasonEligible(candidate, userPreferences)
      )
    );

    if (!registration.reasons.size) {
      if (sessions.get(gameKey)?.token === token) sessions.delete(gameKey);
      return;
    }

    if (sessions.get(gameKey)?.token !== token) return;

    const shareKey = await getCaptureShareKey(gameKey);
    registration.shareKey = shareKey;
    const captureWindow = await acquireCaptureWindow(shareKey, token);

    if (sessions.get(gameKey)?.token !== token) {
      releaseCaptureWindow(shareKey, token);
      return;
    }

    registration.window = captureWindow;
    registration.state = "ready";
    logger.info("Wayland game window capture was prepared", { gameKey });
    registration.subscriptionTimer = setInterval(() => {
      if (!HydraApi.hasActiveSubscription()) {
        stopLinuxGameCaptureSession(gameKey, "souvenir");
      }
    }, 60_000);
    registration.subscriptionTimer.unref?.();
    captureWindow.once("closed", () => {
      if (sessions.get(gameKey)?.token !== token) return;
      if (registration.subscriptionTimer) {
        clearInterval(registration.subscriptionTimer);
        registration.subscriptionTimer = null;
      }
      registration.window = null;
      registration.state = "failed";
      registration.failure = "share_cancelled";
    });
  })().catch(async (error) => {
    registration.state = "failed";
    registration.failure = UNCLASSIFIED_PREPARATION_FAILURE;
    registration.failure = await classifyPreparationFailure(error);
    if (sessions.get(gameKey)?.token === token) {
      logger.warn("Wayland game window capture was not prepared", {
        gameKey,
        failure: registration.failure,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  });

  sessions.set(gameKey, registration);

  try {
    await registration.preparation;
  } catch {
    // A cancelled or unavailable portal session disables capture for this game
    // session. It is intentionally not retried on every achievement unlock.
  }
};

export const getLinuxGameCaptureState = (
  gameKey: string
): LinuxGameCaptureState => sessions.get(gameKey)?.state ?? "failed";

export const getLinuxGameCaptureFailure = (gameKey: string) =>
  sessions.get(gameKey)?.failure ?? null;

export const captureLinuxGameSessionFrame = async (gameKey: string) => {
  const registration = sessions.get(gameKey);
  if (!registration) {
    throw new Error("No Wayland game window capture session is available");
  }

  await registration.preparation;
  const captureWindow = registration.window;

  if (!captureWindow || captureWindow.isDestroyed()) {
    throw new Error(CAPTURE_CLOSED_MESSAGE);
  }

  const capture = captureFrameInWindow(
    captureWindow,
    `
    (async () => {
      const video = globalThis.__hydraSouvenirVideo;
      const track = globalThis.__hydraSouvenirStream?.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error(${SERIALIZED_STREAM_ENDED_MESSAGE});
      }
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error("Wayland screen stream has no video frame");
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create screenshot canvas");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    })()
  `
  );
  registration.activeCaptures.add(capture);

  let dataUrl: unknown;
  try {
    dataUrl = await capture;
  } catch (error) {
    closeCaptureWindowIfStreamEnded(captureWindow, error);
    throw error;
  } finally {
    registration.activeCaptures.delete(capture);
  }

  if (typeof dataUrl !== "string") {
    throw new TypeError(
      "Wayland game window capture returned an invalid frame"
    );
  }

  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("Wayland game window capture returned an empty frame");
  }

  return image;
};

export const grabLinuxGameSessionFrame = async (
  gameKey: string,
  options: ScreenshotFrameGrabOptions
): Promise<GrabbedScreenshotFrame> => {
  const registration = sessions.get(gameKey);
  if (!registration) {
    throw new Error("No Wayland game window capture session is available");
  }

  const isPrepared = await Promise.race([
    registration.preparation.then(() => true),
    new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), CAPTURE_PREPARATION_WAIT_MS)
    ),
  ]);
  if (!isPrepared) {
    throw new Error(
      "Wayland game window capture is not ready, the window share was not granted yet"
    );
  }
  const captureWindow = registration.window;

  if (!captureWindow || captureWindow.isDestroyed()) {
    throw new Error(CAPTURE_CLOSED_MESSAGE);
  }

  const runInCaptureWindow = (expression: string) =>
    captureFrameInWindow(captureWindow, expression);

  let releaseCapture = () => {};
  const capture = new Promise<void>((resolve) => {
    releaseCapture = resolve;
  });
  registration.activeCaptures.add(capture);
  const finishCapture = () => {
    releaseCapture();
    registration.activeCaptures.delete(capture);
  };

  let frame: GrabbedScreenshotFrame;
  try {
    const info = parseGrabbedFrame(
      await runInCaptureWindow(`(async () => {
        const track = globalThis.__hydraSouvenirStream?.getVideoTracks()[0];
        if (!track || track.readyState !== "live") {
          throw new Error(${SERIALIZED_STREAM_ENDED_MESSAGE});
        }
        return await ${buildGrabFrameExpression("globalThis.__hydraSouvenirVideo", options)};
      })()`)
    );
    frame = createGrabbedFrame(info, runInCaptureWindow);
    if (info.isBlank) {
      frame.discard();
      throw new Error("Wayland game window capture returned a blank frame");
    }
  } catch (error) {
    finishCapture();
    closeCaptureWindowIfStreamEnded(captureWindow, error);
    throw error;
  }

  return {
    ...frame,
    encode: (quality: number) => frame.encode(quality).finally(finishCapture),
    discard: () => {
      frame.discard();
      finishCapture();
    },
  };
};

export const stopLinuxGameCaptureSession = (
  gameKey: string,
  reason?: CaptureSessionReason
) => {
  const registration = sessions.get(gameKey);
  if (!registration) return;

  if (reason) {
    registration.reasons = removeCaptureSessionReason(
      registration.reasons,
      reason
    );
    if (registration.reasons.size) return;
  }

  sessions.delete(gameKey);
  if (registration.subscriptionTimer) {
    clearInterval(registration.subscriptionTimer);
  }
  void Promise.allSettled(registration.activeCaptures).finally(() => {
    if (registration.shareKey) {
      releaseCaptureWindow(registration.shareKey, registration.token);
    }
  });
};

export const stopAllLinuxGameCaptureSessions = (
  reason?: CaptureSessionReason
) => {
  for (const gameKey of sessions.keys()) {
    stopLinuxGameCaptureSession(gameKey, reason);
  }
};
