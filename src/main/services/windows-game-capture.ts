import { BrowserWindow, nativeImage } from "electron";
import capturePagePath from "@resources/linux-game-capture.html?asset";

import { logger } from "./logger";
import {
  isNearlyUniformScreenshot,
  type ScreenshotColorRange,
} from "./screenshot-frame-validation";

const MAX_CAPTURE_ATTEMPTS = 3;

interface CapturedFramePayload {
  dataUrl: string;
  width: number;
  height: number;
  colorRange: ScreenshotColorRange;
}

const isChannelRange = (value: unknown) => {
  if (!value || typeof value !== "object") return false;

  const range = value as Record<string, unknown>;
  return typeof range.min === "number" && typeof range.max === "number";
};

const isCapturedFramePayload = (
  value: unknown
): value is CapturedFramePayload => {
  if (!value || typeof value !== "object") return false;

  const payload = value as Record<string, unknown>;
  const colorRange = payload.colorRange;
  if (!colorRange || typeof colorRange !== "object") return false;

  const channels = colorRange as Record<string, unknown>;

  return (
    typeof payload.dataUrl === "string" &&
    typeof payload.width === "number" &&
    typeof payload.height === "number" &&
    isChannelRange(channels.red) &&
    isChannelRange(channels.green) &&
    isChannelRange(channels.blue)
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
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create screenshot canvas");
      context.drawImage(video, 0, 0, width, height);

      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = 32;
      sampleCanvas.height = 32;
      const sampleContext = sampleCanvas.getContext("2d", {
        willReadFrequently: true
      });
      if (!sampleContext) throw new Error("Could not validate screenshot frame");
      sampleContext.drawImage(canvas, 0, 0, 32, 32);
      const pixels = sampleContext.getImageData(0, 0, 32, 32).data;
      const colorRange = {
        red: { min: 255, max: 0 },
        green: { min: 255, max: 0 },
        blue: { min: 255, max: 0 }
      };
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        colorRange.red.min = Math.min(colorRange.red.min, red);
        colorRange.red.max = Math.max(colorRange.red.max, red);
        colorRange.green.min = Math.min(colorRange.green.min, green);
        colorRange.green.max = Math.max(colorRange.green.max, green);
        colorRange.blue.min = Math.min(colorRange.blue.min, blue);
        colorRange.blue.max = Math.max(colorRange.blue.max, blue);
      }

      return {
        dataUrl: canvas.toDataURL("image/png"),
        width,
        height,
        colorRange
      };
    })()
  `);

  if (!isCapturedFramePayload(result)) {
    throw new TypeError(
      "Windows game-window capture returned an invalid frame"
    );
  }

  return result;
};

export const captureWindowsGameWindowFrame = async (sourceId: string) => {
  const captureWindow = await createCaptureWindow(sourceId);

  try {
    for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt++) {
      const frame = await captureFrame(captureWindow);
      const image = nativeImage.createFromDataURL(frame.dataUrl);
      const isBlank =
        image.isEmpty() || isNearlyUniformScreenshot(frame.colorRange);

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
