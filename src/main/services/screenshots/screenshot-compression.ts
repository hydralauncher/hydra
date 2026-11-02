import sharp from "sharp";
import type { ScreenshotQuality } from "@types";

import { logger } from "../logger";
import {
  encodeWithinByteCap,
  fitSizeInsideBox,
  isUndecodableImageError,
  SCREENSHOT_THUMBNAIL_BOX,
  SCREENSHOT_TIER_BOXES,
  type ScreenshotBox,
} from "./screenshot-compression-plan";

export interface CompressedScreenshot {
  quality: ScreenshotQuality;
  image: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}

const encodeJpeg = async (
  input: Buffer,
  sourceSize: { width: number; height: number },
  box: ScreenshotBox
) => {
  const size = fitSizeInsideBox(sourceSize, box);
  const { buffer } = await encodeWithinByteCap(
    (quality) =>
      sharp(input)
        .resize(size.width, size.height, { fit: "fill" })
        .jpeg({ quality })
        .toBuffer(),
    box
  );

  return { buffer, ...size };
};

const SCREENSHOT_UNREADABLE_CODE = "screenshot_unreadable";
const SCREENSHOT_COMPRESSION_FAILED_CODE = "screenshot_compression_failed";
const KEPT_COMPRESSION_ERRORS = new Set([
  SCREENSHOT_UNREADABLE_CODE,
  "screenshot_too_large",
]);

const compress = async (
  original: Buffer,
  quality: ScreenshotQuality
): Promise<CompressedScreenshot> => {
  const metadata = await sharp(original).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(SCREENSHOT_UNREADABLE_CODE);
  }

  const sourceSize = { width: metadata.width, height: metadata.height };
  const image = await encodeJpeg(
    original,
    sourceSize,
    SCREENSHOT_TIER_BOXES[quality]
  );
  const thumbnail = await encodeJpeg(
    image.buffer,
    { width: image.width, height: image.height },
    SCREENSHOT_THUMBNAIL_BOX
  );

  return {
    quality,
    image: image.buffer,
    thumbnail: thumbnail.buffer,
    width: image.width,
    height: image.height,
  };
};

export const compressScreenshotForUpload = async (
  original: Buffer,
  quality: ScreenshotQuality
) => {
  try {
    return await compress(original, quality);
  } catch (error) {
    if (error instanceof Error && KEPT_COMPRESSION_ERRORS.has(error.message)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (isUndecodableImageError(error)) {
      logger.warn("Could not decode a screenshot for upload", {
        error: message,
      });
      throw new Error(SCREENSHOT_UNREADABLE_CODE, { cause: error });
    }
    logger.warn("Could not compress a screenshot for upload", {
      error: message,
    });
    throw new Error(SCREENSHOT_COMPRESSION_FAILED_CODE, { cause: error });
  }
};
