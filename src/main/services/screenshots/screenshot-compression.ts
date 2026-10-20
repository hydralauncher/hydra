import sharp from "sharp";
import type { ScreenshotQuality } from "@types";

import {
  encodeWithinByteCap,
  fitSizeInsideBox,
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

export const compressScreenshotForUpload = async (
  original: Buffer,
  quality: ScreenshotQuality
): Promise<CompressedScreenshot> => {
  const metadata = await sharp(original).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("screenshot_unreadable");
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
