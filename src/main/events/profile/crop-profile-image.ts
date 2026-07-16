import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import sharp from "sharp";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";

export interface CropProfileImageParams {
  /** Crop rectangle in source-image (per-frame) pixels, in the rotated
   * orientation the user sees in the editor. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Final output dimensions. */
  outputWidth: number;
  outputHeight: number;
  /** Clockwise rotation applied before cropping (0 | 90 | 180 | 270). */
  rotation?: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Crops + resizes a profile image while preserving animation for GIF/WebP.
 *
 * Reads the source with `{ animated: true }` so `extract` operates per frame
 * (libvips treats each animation frame as a page), then outputs an animated
 * WebP. Rotation needs special handling: libvips cannot rotate a multi-page
 * image in one pass, so animated sources are rotated/cropped frame-by-frame
 * and re-joined.
 */
const cropProfileImage = async (
  _event: Electron.IpcMainInvokeEvent,
  sourcePath: string,
  params: CropProfileImageParams
): Promise<{ imagePath: string }> => {
  try {
    return await cropProfileImageInternal(sourcePath, params);
  } catch (error) {
    logger.error("Failed to crop profile image", sourcePath, params, error);
    throw error;
  }
};

const cropProfileImageInternal = async (
  sourcePath: string,
  params: CropProfileImageParams
): Promise<{ imagePath: string }> => {
  const { outputWidth, outputHeight } = params;
  const rotation = (((params.rotation ?? 0) % 360) + 360) % 360;

  const baseMetadata = await sharp(sourcePath, { animated: true }).metadata();

  const sourceWidth = baseMetadata.width ?? 0;
  // For animated input `pageHeight` is the per-frame height; for static
  // images it is undefined, so fall back to the full height.
  const sourceHeight = baseMetadata.pageHeight ?? baseMetadata.height ?? 0;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("Could not read source image dimensions");
  }

  // After rotation by 90°/270° the frame's width/height swap.
  const isQuarterTurn = rotation === 90 || rotation === 270;
  const frameWidth = isQuarterTurn ? sourceHeight : sourceWidth;
  const frameHeight = isQuarterTurn ? sourceWidth : sourceHeight;

  const left = clamp(Math.round(params.left), 0, frameWidth - 1);
  const top = clamp(Math.round(params.top), 0, frameHeight - 1);
  const width = clamp(Math.round(params.width), 1, frameWidth - left);
  const height = clamp(Math.round(params.height), 1, frameHeight - top);
  const extractRegion = { left, top, width, height };

  const pages =
    baseMetadata.pages && baseMetadata.pages > 1 ? baseMetadata.pages : 1;

  let buffer: Buffer;

  if (rotation === 0) {
    // Single pass handles both static and animated inputs.
    buffer = await sharp(sourcePath, { animated: true })
      .extract(extractRegion)
      .resize(outputWidth, outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
  } else if (pages === 1) {
    // Rotate to its own buffer first so the extract runs in rotated space
    // (sharp's internal op ordering doesn't guarantee rotate-before-extract
    // when chained directly).
    const rotated = await sharp(sourcePath).rotate(rotation).toBuffer();
    buffer = await sharp(rotated)
      .extract(extractRegion)
      .resize(outputWidth, outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
  } else {
    // Animated + rotation: rotate/crop each frame, then re-join.
    const frames: Buffer[] = [];

    for (let page = 0; page < pages; page++) {
      const rotated = await sharp(sourcePath, { page, pages: 1 })
        .rotate(rotation)
        .toBuffer();

      frames.push(
        await sharp(rotated)
          .extract(extractRegion)
          .resize(outputWidth, outputHeight, { fit: "fill" })
          .png()
          .toBuffer()
      );
    }

    buffer = await sharp(frames, { join: { animated: true } })
      .webp({
        quality: 90,
        effort: 4,
        loop: baseMetadata.loop ?? 0,
        delay: baseMetadata.delay,
      })
      .toBuffer();
  }

  const tempFilePath = path.join(
    app.getPath("temp"),
    `hydra-temp-${Date.now()}-profile-crop.webp`
  );

  fs.writeFileSync(tempFilePath, buffer);

  return { imagePath: tempFilePath };
};

registerEvent("cropProfileImage", cropProfileImage);
