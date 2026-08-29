import { BrowserWindow, desktopCapturer, nativeImage } from "electron";
import type { UserPreferences } from "@types";
import { isAchievementSouvenirsEnabled } from "@shared";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { db, levelKeys } from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";

interface CaptureSessionRegistration {
  token: object;
  window: BrowserWindow | null;
  subscriptionTimer: ReturnType<typeof setInterval> | null;
  preparation: Promise<void>;
}

const sessions = new Map<string, CaptureSessionRegistration>();

export const isWaylandSession = () =>
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland" ||
    Boolean(process.env.WAYLAND_DISPLAY));

const destroyCaptureWindow = (captureWindow: BrowserWindow | null) => {
  if (!captureWindow || captureWindow.isDestroyed()) return;

  void captureWindow.webContents
    .executeJavaScript(
      "globalThis.__hydraSouvenirStream?.getTracks().forEach((track) => track.stop())"
    )
    .catch(() => {})
    .finally(() => {
      if (!captureWindow.isDestroyed()) captureWindow.destroy();
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

export const prepareLinuxGameCaptureSession = async (gameKey: string) => {
  if (!isWaylandSession() || sessions.has(gameKey)) return;
  if (!HydraApi.hasActiveSubscription()) return;

  const token = {};
  const registration: CaptureSessionRegistration = {
    token,
    window: null,
    subscriptionTimer: null,
    preparation: Promise.resolve(),
  };

  registration.preparation = (async () => {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    if (
      !isAchievementSouvenirsEnabled(
        userPreferences?.enableAchievementSouvenirs,
        process.platform
      ) ||
      !HydraApi.hasActiveSubscription()
    ) {
      if (sessions.get(gameKey)?.token === token) sessions.delete(gameKey);
      return;
    }

    if (sessions.get(gameKey)?.token !== token) return;

    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 0, height: 0 },
    });
    const source = sources.length === 1 ? sources[0] : null;

    if (!source?.id.startsWith("window:")) {
      throw new Error("No Wayland window capture source was selected");
    }

    if (sessions.get(gameKey)?.token !== token) return;

    const captureWindow = await createCaptureWindow(source.id);

    if (sessions.get(gameKey)?.token !== token) {
      destroyCaptureWindow(captureWindow);
      return;
    }

    registration.window = captureWindow;
    logger.info("Wayland game-window capture was prepared", { gameKey });
    registration.subscriptionTimer = setInterval(() => {
      if (!HydraApi.hasActiveSubscription()) {
        stopLinuxGameCaptureSession(gameKey);
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
      logger.warn("Wayland game-window capture was not prepared", {
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
    throw new Error("No Wayland game-window capture session is available");
  }

  await registration.preparation;
  const captureWindow = registration.window;

  if (!captureWindow || captureWindow.isDestroyed()) {
    throw new Error("Wayland game-window capture session was closed");
  }

  const dataUrl = await captureWindow.webContents.executeJavaScript(`
    (() => {
      const video = globalThis.__hydraSouvenirVideo;
      const track = globalThis.__hydraSouvenirStream?.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error("Wayland game-window stream is no longer active");
      }
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error("Wayland game-window stream has no video frame");
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

  if (typeof dataUrl !== "string") {
    throw new TypeError(
      "Wayland game-window capture returned an invalid frame"
    );
  }

  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("Wayland game-window capture returned an empty frame");
  }

  return image;
};

export const stopLinuxGameCaptureSession = (gameKey: string) => {
  const registration = sessions.get(gameKey);
  if (!registration) return;

  sessions.delete(gameKey);
  if (registration.subscriptionTimer) {
    clearInterval(registration.subscriptionTimer);
  }
  destroyCaptureWindow(registration.window);
};

export const stopAllLinuxGameCaptureSessions = () => {
  for (const gameKey of sessions.keys()) stopLinuxGameCaptureSession(gameKey);
};
