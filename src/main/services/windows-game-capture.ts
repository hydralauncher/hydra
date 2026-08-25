import { BrowserWindow, nativeImage } from "electron";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { logger } from "./logger";
import { fitScreenshotTo1080p } from "./screenshot-size";
import {
  getBitmapColorRange,
  isNearlyUniformScreenshot,
} from "./screenshot-frame-validation";

const MAX_CAPTURE_ATTEMPTS = 3;
const FRAME_VALIDATION_SAMPLE_SIZE = 32;

interface CapturedFramePayload {
  width: number;
  height: number;
  supportsSdrDynamicRangeLimit: boolean;
  fallbackDataUrl: string | null;
}

const isCapturedFramePayload = (
  value: unknown
): value is CapturedFramePayload => {
  if (!value || typeof value !== "object") return false;

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.width === "number" &&
    typeof payload.height === "number" &&
    typeof payload.supportsSdrDynamicRangeLimit === "boolean" &&
    (payload.fallbackDataUrl === null ||
      typeof payload.fallbackDataUrl === "string")
  );
};

const destroyCaptureWindow = (captureWindow: BrowserWindow) => {
  if (captureWindow.isDestroyed()) return;

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
          throw new Error("MediaDevices is unavailable in the Windows capture page");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: ${serializedSourceId},
              maxWidth: 7680,
              maxHeight: 4320,
              maxFrameRate: 5
            }
          }
        });
        const video = document.querySelector("video");
        if (!(video instanceof HTMLVideoElement)) {
          throw new Error("Windows capture page has no video element");
        }
        video.srcObject = stream;
        await video.play();
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await Promise.race([
            new Promise((resolve, reject) => {
              video.addEventListener("loadeddata", resolve, { once: true });
              video.addEventListener("error", reject, { once: true });
            }),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Windows capture stream timed out")), 3000);
            })
          ]);
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

const captureFrame = async (captureWindow: BrowserWindow) => {
  const result: unknown = await captureWindow.webContents.executeJavaScript(`
    (async () => {
      const video = globalThis.__hydraSouvenirVideo;
      const track = globalThis.__hydraSouvenirStream?.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error("Windows game-window stream is no longer active");
      }
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error("Windows game-window stream has no video frame");
      }
      await new Promise((resolve) => {
        let completed = false;
        const complete = () => {
          if (completed) return;
          completed = true;
          resolve(undefined);
        };
        setTimeout(complete, 500);
        if (typeof video.requestVideoFrameCallback === "function") {
          video.requestVideoFrameCallback(complete);
        } else {
          requestAnimationFrame(() => requestAnimationFrame(complete));
        }
      });
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        throw new Error("Windows game-window stream returned an empty frame");
      }

      const supportsSdrDynamicRangeLimit = CSS.supports(
        "dynamic-range-limit",
        "standard"
      );
      let fallbackDataUrl = null;

      if (!supportsSdrDynamicRangeLimit) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create screenshot canvas");
        context.drawImage(video, 0, 0, width, height);
        fallbackDataUrl = canvas.toDataURL("image/png");
      }

      return {
        width,
        height,
        supportsSdrDynamicRangeLimit,
        fallbackDataUrl
      };
    })()
  `);

  if (!isCapturedFramePayload(result)) {
    throw new TypeError(
      "Windows game-window capture returned an invalid frame"
    );
  }

  if (!result.supportsSdrDynamicRangeLimit) {
    logger.warn(
      "Chromium does not support SDR dynamic range limiting for screenshots"
    );
    if (!result.fallbackDataUrl) {
      throw new Error("Could not create fallback Windows screenshot frame");
    }

    return {
      ...result,
      image: nativeImage.createFromDataURL(result.fallbackDataUrl),
    };
  }

  const captureSize = fitScreenshotTo1080p(result);
  captureWindow.setContentSize(captureSize.width, captureSize.height);
  await captureWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })
  `);

  return {
    ...result,
    image: await captureWindow.webContents.capturePage(undefined, {
      stayHidden: true,
    }),
  };
};

export const captureWindowsGameWindowFrame = async (sourceId: string) => {
  const captureWindow = await createCaptureWindow(sourceId);

  try {
    for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt++) {
      const frame = await captureFrame(captureWindow);
      const image = frame.image;
      const sample = image.resize({
        width: FRAME_VALIDATION_SAMPLE_SIZE,
        height: FRAME_VALIDATION_SAMPLE_SIZE,
        quality: "good",
      });
      const isBlank =
        image.isEmpty() ||
        isNearlyUniformScreenshot(getBitmapColorRange(sample.toBitmap()));

      if (!isBlank) return image;

      logger.warn("Windows game-window capture returned a blank frame", {
        sourceId,
        attempt,
        width: frame.width,
        height: frame.height,
      });
    }

    throw new Error("Windows game-window capture returned only blank frames");
  } finally {
    destroyCaptureWindow(captureWindow);
  }
};
