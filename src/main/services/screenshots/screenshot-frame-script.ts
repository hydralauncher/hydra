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
export const SCREENSHOT_CAPTURE_CALL_TIMEOUT_MS = 10_000;

const CAPTURED_FRAME_GLOBAL = "globalThis.__hydraCapturedFrame";

export interface ScreenshotFrameCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ScreenshotFrameGrabOptions {
  waitForNextFrame: boolean;
  crop?: ScreenshotFrameCrop | null;
}

export interface GrabbedFrameInfo {
  width: number;
  height: number;
  isBlank: boolean;
}

export interface EncodedScreenshotImages {
  jpeg: Buffer;
  preview: Buffer;
}

export interface GrabbedScreenshotFrame {
  width: number;
  height: number;
  encode: (quality: number) => Promise<EncodedScreenshotImages>;
  discard: () => void;
}

const GRAB_FRAME_FUNCTION = `async (video, options) => {
  const previous = ${CAPTURED_FRAME_GLOBAL};
  if (previous) {
    previous.width = 0;
    previous.height = 0;
    ${CAPTURED_FRAME_GLOBAL} = null;
  }
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
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) throw new Error("Screenshot stream returned an empty frame");
  let sourceX = 0;
  let sourceY = 0;
  let width = videoWidth;
  let height = videoHeight;
  if (options.crop) {
    const scaleX = videoWidth / options.crop.sourceWidth;
    const scaleY = videoHeight / options.crop.sourceHeight;
    sourceX = Math.round(options.crop.x * scaleX);
    sourceY = Math.round(options.crop.y * scaleY);
    width = Math.min(videoWidth - sourceX, Math.round(options.crop.width * scaleX));
    height = Math.min(videoHeight - sourceY, Math.round(options.crop.height * scaleY));
    if (width <= 0 || height <= 0) {
      sourceX = 0;
      sourceY = 0;
      width = videoWidth;
      height = videoHeight;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(video, sourceX, sourceY, width, height, 0, 0, width, height);
  const sample = document.createElement("canvas");
  sample.width = options.sampleSize;
  sample.height = options.sampleSize;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  sampleContext.drawImage(canvas, 0, 0, options.sampleSize, options.sampleSize);
  const pixels = new Uint8Array(sampleContext.getImageData(0, 0, options.sampleSize, options.sampleSize).data);
  ${CAPTURED_FRAME_GLOBAL} = canvas;
  return { width, height, pixels };
}`;

const ENCODE_FRAME_FUNCTION = `async (options) => {
  const canvas = ${CAPTURED_FRAME_GLOBAL};
  if (!canvas || !canvas.width || !canvas.height) throw new Error("No captured screenshot frame to encode");
  const toBytes = (target, quality) => {
    const dataUrl = target.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(base64);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };
  const preview = document.createElement("canvas");
  try {
    const previewWidth = Math.min(canvas.width, options.previewMaxWidth);
    preview.width = previewWidth;
    preview.height = Math.max(1, Math.round((canvas.height * previewWidth) / canvas.width));
    preview.getContext("2d").drawImage(canvas, 0, 0, preview.width, preview.height);
    return {
      jpeg: toBytes(canvas, options.quality),
      preview: toBytes(preview, options.previewQuality),
    };
  } finally {
    preview.width = 0;
    preview.height = 0;
    canvas.width = 0;
    canvas.height = 0;
    if (${CAPTURED_FRAME_GLOBAL} === canvas) ${CAPTURED_FRAME_GLOBAL} = null;
  }
}`;

export const buildGrabFrameExpression = (
  videoExpression: string,
  options: ScreenshotFrameGrabOptions
) =>
  `(${GRAB_FRAME_FUNCTION})(${videoExpression}, ${JSON.stringify({
    waitForNextFrame: options.waitForNextFrame,
    crop: options.crop ?? null,
    sampleSize: SCREENSHOT_FRAME_SAMPLE_SIZE,
    nextFrameTimeout: SCREENSHOT_NEXT_FRAME_TIMEOUT_MS,
    firstFrameTimeout: SCREENSHOT_FIRST_FRAME_TIMEOUT_MS,
  })})`;

export const buildEncodeFrameExpression = (quality: number) =>
  `(${ENCODE_FRAME_FUNCTION})(${JSON.stringify({
    quality,
    previewMaxWidth: SCREENSHOT_PREVIEW_MAX_WIDTH,
    previewQuality: SCREENSHOT_PREVIEW_JPEG_QUALITY,
  })})`;

export const DISCARD_FRAME_EXPRESSION = `(() => {
  const canvas = ${CAPTURED_FRAME_GLOBAL};
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
  ${CAPTURED_FRAME_GLOBAL} = null;
})()`;

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

export const parseGrabbedFrame = (value: unknown): GrabbedFrameInfo => {
  const frame = value as Record<string, unknown> | null;
  if (
    !frame ||
    typeof frame.width !== "number" ||
    typeof frame.height !== "number" ||
    !isByteArray(frame.pixels)
  ) {
    throw new TypeError("Screenshot capture returned an invalid frame");
  }

  const bgra = toBgra(frame.pixels);
  return {
    width: frame.width,
    height: frame.height,
    isBlank:
      isNearlyUniformScreenshot(getBitmapColorRange(bgra)) ||
      isMostlyBlackScreenshot(bgra),
  };
};

export const parseEncodedImages = (value: unknown): EncodedScreenshotImages => {
  const images = value as Record<string, unknown> | null;
  if (
    !images ||
    !isByteArray(images.jpeg) ||
    !isByteArray(images.preview) ||
    !images.jpeg.length
  ) {
    throw new TypeError("Screenshot capture returned an invalid image");
  }

  return {
    jpeg: Buffer.from(images.jpeg),
    preview: Buffer.from(images.preview),
  };
};

export const createGrabbedFrame = (
  info: Pick<GrabbedFrameInfo, "width" | "height">,
  runInPage: (expression: string) => Promise<unknown>
): GrabbedScreenshotFrame => {
  let isSettled = false;

  return {
    width: info.width,
    height: info.height,
    encode: async (quality) => {
      if (isSettled) throw new Error("The screenshot frame was already used");
      isSettled = true;
      return parseEncodedImages(
        await runInPage(buildEncodeFrameExpression(quality))
      );
    },
    discard: () => {
      if (isSettled) return;
      isSettled = true;
      void runInPage(DISCARD_FRAME_EXPRESSION).catch(() => undefined);
    },
  };
};
