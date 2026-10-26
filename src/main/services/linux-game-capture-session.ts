import { app, BrowserWindow, desktopCapturer, nativeImage } from "electron";
import type { UserPreferences } from "@types";
import {
  isAchievementSouvenirsEnabled,
  resolveScreenshotPreferences,
} from "@shared";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { db, levelKeys } from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import {
  buildGrabFrameExpression,
  createGrabbedFrame,
  parseGrabbedFrame,
  type GrabbedScreenshotFrame,
  type ScreenshotFrameGrabOptions,
} from "./screenshots/screenshot-frame-script";
import {
  addCaptureSessionReason,
  removeCaptureSessionReason,
  type CaptureSessionReason,
} from "./linux-game-capture-session-reasons";

interface CaptureSessionRegistration {
  token: object;
  window: BrowserWindow | null;
  subscriptionTimer: ReturnType<typeof setInterval> | null;
  preparation: Promise<void>;
  reasons: Set<CaptureSessionReason>;
  activeCapture: Promise<unknown> | null;
}

const sessions = new Map<string, CaptureSessionRegistration>();
const CAPTURE_TEARDOWN_DELAY_MS = 1_000;

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

const readUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

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

let rememberedScreenSourceId: string | null = null;
let pendingScreenSourcePick: Promise<string> | null = null;

const destroyCaptureWindow = (captureWindow: BrowserWindow | null) => {
  if (!captureWindow || captureWindow.isDestroyed()) return;

  void captureWindow.webContents
    .executeJavaScript(
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
    await captureWindow.webContents.executeJavaScript(`
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
        globalThis.__hydraSouvenirStream = stream;
        globalThis.__hydraSouvenirVideo = video;
      })()
    `);

    return captureWindow;
  } catch (error) {
    if (!captureWindow.isDestroyed()) captureWindow.destroy();
    throw error;
  }
};

const pickScreenSource = async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 },
  });
  const source = sources.length === 1 ? sources[0] : null;

  if (!source?.id.startsWith("screen:")) {
    throw new Error("No Wayland screen capture source was selected");
  }

  return source.id;
};

const pickScreenSourceOnce = () => {
  pendingScreenSourcePick ??= pickScreenSource().finally(() => {
    pendingScreenSourcePick = null;
  });
  return pendingScreenSourcePick;
};

const restoreRememberedScreenCapture = async () => {
  const sourceId = rememberedScreenSourceId;
  if (!sourceId) return null;

  try {
    return await createCaptureWindow(sourceId);
  } catch (error) {
    logger.warn("Remembered Wayland screen source could not be restored", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (rememberedScreenSourceId === sourceId) rememberedScreenSourceId = null;
    return null;
  }
};

const openScreenCaptureWindow = async () => {
  const restored = await restoreRememberedScreenCapture();
  if (restored) return restored;

  const sourceId = await pickScreenSourceOnce();
  const captureWindow = await createCaptureWindow(sourceId);
  rememberedScreenSourceId = sourceId;
  return captureWindow;
};

export const prepareLinuxGameCaptureSession = async (
  gameKey: string,
  reason: CaptureSessionReason = "souvenir"
) => {
  if (!isWaylandCaptureBackend()) return;
  if (reason === "souvenir" && !HydraApi.hasActiveSubscription()) return;

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
    window: null,
    subscriptionTimer: null,
    preparation: Promise.resolve(),
    reasons: new Set([reason]),
    activeCapture: null,
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

    const captureWindow = await openScreenCaptureWindow();

    if (sessions.get(gameKey)?.token !== token) {
      destroyCaptureWindow(captureWindow);
      return;
    }

    registration.window = captureWindow;
    logger.info("Wayland screen capture was prepared", { gameKey });
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
      }
      sessions.delete(gameKey);
    });
  })().catch((error) => {
    if (sessions.get(gameKey)?.token === token) {
      logger.warn("Wayland screen capture was not prepared", {
        gameKey,
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

export const captureLinuxGameSessionFrame = async (gameKey: string) => {
  const registration = sessions.get(gameKey);
  if (!registration) {
    throw new Error("No Wayland screen capture session is available");
  }

  await registration.preparation;
  const captureWindow = registration.window;

  if (!captureWindow || captureWindow.isDestroyed()) {
    throw new Error("Wayland screen capture session was closed");
  }

  const capture = captureWindow.webContents.executeJavaScript(`
    (() => {
      const video = globalThis.__hydraSouvenirVideo;
      const track = globalThis.__hydraSouvenirStream?.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error("Wayland screen stream is no longer active");
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
  `);
  registration.activeCapture = capture;

  let dataUrl: unknown;
  try {
    dataUrl = await capture;
  } finally {
    if (registration.activeCapture === capture) {
      registration.activeCapture = null;
    }
  }

  if (typeof dataUrl !== "string") {
    throw new TypeError("Wayland screen capture returned an invalid frame");
  }

  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("Wayland screen capture returned an empty frame");
  }

  return image;
};

export const grabLinuxGameSessionFrame = async (
  gameKey: string,
  options: ScreenshotFrameGrabOptions
): Promise<GrabbedScreenshotFrame> => {
  const registration = sessions.get(gameKey);
  if (!registration) {
    throw new Error("No Wayland screen capture session is available");
  }

  await registration.preparation;
  const captureWindow = registration.window;

  if (!captureWindow || captureWindow.isDestroyed()) {
    throw new Error("Wayland screen capture session was closed");
  }

  const runInCaptureWindow = (expression: string) =>
    captureWindow.isDestroyed()
      ? Promise.reject(new Error("Wayland screen capture session was closed"))
      : captureWindow.webContents.executeJavaScript(expression);

  const info = parseGrabbedFrame(
    await captureWindow.webContents.executeJavaScript(`(async () => {
      const track = globalThis.__hydraSouvenirStream?.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error("Wayland screen stream is no longer active");
      }
      return await ${buildGrabFrameExpression("globalThis.__hydraSouvenirVideo", options)};
    })()`)
  );
  const frame = createGrabbedFrame(info, runInCaptureWindow);
  if (info.isBlank) {
    frame.discard();
    throw new Error("Wayland screen capture returned a blank frame");
  }
  return frame;
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
  const pendingCapture = registration.activeCapture ?? Promise.resolve();
  void pendingCapture
    .catch(() => {})
    .finally(() => destroyCaptureWindow(registration.window));
};

export const stopAllLinuxGameCaptureSessions = (
  reason?: CaptureSessionReason
) => {
  for (const gameKey of sessions.keys()) {
    stopLinuxGameCaptureSession(gameKey, reason);
  }
};
