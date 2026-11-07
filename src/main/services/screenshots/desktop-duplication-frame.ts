import { logger } from "../logger";
import { NativeAddon } from "../native-addon";
import {
  isBlankBgraSample,
  SCREENSHOT_FRAME_SAMPLE_SIZE,
  SCREENSHOT_PREVIEW_JPEG_QUALITY,
  SCREENSHOT_PREVIEW_MAX_WIDTH,
  type GrabbedScreenshotFrame,
} from "./screenshot-frame-script";

const BYTES_PER_PIXEL = 4;
const toJpegQuality = (quality: number) => Math.round(quality * 100);

const sampleBgraFrame = (pixels: Buffer, width: number, height: number) => {
  const size = SCREENSHOT_FRAME_SAMPLE_SIZE;
  const sample = new Uint8Array(size * size * BYTES_PER_PIXEL);
  for (let row = 0; row < size; row++) {
    const y = Math.floor(((row + 0.5) * height) / size);
    for (let column = 0; column < size; column++) {
      const x = Math.floor(((column + 0.5) * width) / size);
      const from = (y * width + x) * BYTES_PER_PIXEL;
      const to = (row * size + column) * BYTES_PER_PIXEL;
      pixels.copy(sample, to, from, from + BYTES_PER_PIXEL);
    }
  }
  return sample;
};

export const grabDesktopDuplicationFrame = async (
  windowHandle: string | null | undefined
): Promise<GrabbedScreenshotFrame | null> => {
  if (process.platform !== "win32" || !windowHandle) return null;

  const frame = await NativeAddon.captureWindowsDesktopFrame(windowHandle);
  if (!frame) return null;

  const { width, height, pixels } = frame;
  if (isBlankBgraSample(sampleBgraFrame(pixels, width, height))) {
    logger.warn("Desktop duplication returned a blank frame", { windowHandle });
    return null;
  }

  return {
    width,
    height,
    encode: (quality) =>
      NativeAddon.encodeBgraScreenshot({
        pixels,
        width,
        height,
        quality: toJpegQuality(quality),
        previewMaxWidth: SCREENSHOT_PREVIEW_MAX_WIDTH,
        previewQuality: toJpegQuality(SCREENSHOT_PREVIEW_JPEG_QUALITY),
      }),
    discard: () => {},
  };
};
