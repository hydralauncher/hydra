import {
  getBitmapColorRange,
  isMostlyBlackScreenshot,
  isNearlyUniformScreenshot,
} from "../screenshot-frame-validation";

export const SCREENSHOT_PREVIEW_MAX_WIDTH = 1280;
export const SCREENSHOT_PREVIEW_JPEG_QUALITY = 0.85;
export const SCREENSHOT_FRAME_SAMPLE_SIZE = 32;
export const SCREENSHOT_NEXT_FRAME_TIMEOUT_MS = 150;
export const SCREENSHOT_FIRST_FRAME_TIMEOUT_MS = 3_000;

export interface ScreenshotFrameEncodeOptions {
  quality: number;
  waitForNextFrame: boolean;
}

export interface EncodedScreenshotFrame {
  width: number;
  height: number;
  jpeg: Buffer;
  preview: Buffer;
  isBlank: boolean;
}

const ENCODE_FRAME_FUNCTION = `async (video, options) => {
  const decode = (dataUrl) => {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Screenshot stream timed out")), options.firstFrameTimeout);
      video.addEventListener("loadeddata", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
  if (options.waitForNextFrame && typeof video.requestVideoFrameCallback === "function") {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, options.nextFrameTimeout);
      video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
    });
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("Screenshot stream returned an empty frame");
  const canvas = document.createElement("canvas");
  const preview = document.createElement("canvas");
  const sample = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(video, 0, 0, width, height);
    sample.width = options.sampleSize;
    sample.height = options.sampleSize;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(canvas, 0, 0, options.sampleSize, options.sampleSize);
    const pixels = new Uint8Array(sampleContext.getImageData(0, 0, options.sampleSize, options.sampleSize).data);
    const previewWidth = Math.min(width, options.previewMaxWidth);
    preview.width = previewWidth;
    preview.height = Math.max(1, Math.round((height * previewWidth) / width));
    preview.getContext("2d").drawImage(canvas, 0, 0, preview.width, preview.height);
    return {
      width,
      height,
      pixels,
      jpeg: decode(canvas.toDataURL("image/jpeg", options.quality)),
      preview: decode(preview.toDataURL("image/jpeg", options.previewQuality)),
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    preview.width = 0;
    preview.height = 0;
  }
}`;

export const buildEncodeFrameExpression = (
  videoExpression: string,
  options: ScreenshotFrameEncodeOptions
) =>
  `(${ENCODE_FRAME_FUNCTION})(${videoExpression}, ${JSON.stringify({
    quality: options.quality,
    waitForNextFrame: options.waitForNextFrame,
    previewMaxWidth: SCREENSHOT_PREVIEW_MAX_WIDTH,
    previewQuality: SCREENSHOT_PREVIEW_JPEG_QUALITY,
    sampleSize: SCREENSHOT_FRAME_SAMPLE_SIZE,
    nextFrameTimeout: SCREENSHOT_NEXT_FRAME_TIMEOUT_MS,
    firstFrameTimeout: SCREENSHOT_FIRST_FRAME_TIMEOUT_MS,
  })})`;

const toBgra = (rgba: Uint8Array) => {
  const bgra = new Uint8Array(rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    bgra[index] = rgba[index + 2];
    bgra[index + 1] = rgba[index + 1];
    bgra[index + 2] = rgba[index];
    bgra[index + 3] = rgba[index + 3];
  }
  return bgra;
};

const isByteArray = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array;

export const parseEncodedFrame = (value: unknown): EncodedScreenshotFrame => {
  const frame = value as Record<string, unknown> | null;
  if (
    !frame ||
    typeof frame.width !== "number" ||
    typeof frame.height !== "number" ||
    !isByteArray(frame.jpeg) ||
    !isByteArray(frame.preview) ||
    !isByteArray(frame.pixels) ||
    !frame.jpeg.length
  ) {
    throw new TypeError("Screenshot capture returned an invalid frame");
  }

  const bgra = toBgra(frame.pixels);
  return {
    width: frame.width,
    height: frame.height,
    jpeg: Buffer.from(frame.jpeg),
    preview: Buffer.from(frame.preview),
    isBlank:
      isNearlyUniformScreenshot(getBitmapColorRange(bgra)) ||
      isMostlyBlackScreenshot(bgra),
  };
};
