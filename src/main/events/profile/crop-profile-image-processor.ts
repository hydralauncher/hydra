import sharp from "sharp";

export const CROP_IMAGE_LIMIT_INPUT_PIXELS = 1_000_000_000;

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
  /** Allows bypassing processing when the user did not edit an image that
   * already matches the requested output dimensions. */
  skipProcessingIfUnchanged?: boolean;
}

export interface CropProfileImageResult {
  data: Buffer;
  info: sharp.OutputInfo;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getInputOptions = (
  options: sharp.SharpOptions = {}
): sharp.SharpOptions => ({
  ...options,
  limitInputPixels: CROP_IMAGE_LIMIT_INPUT_PIXELS,
});

export const getCropProfileImageMetadata = (sourcePath: string) =>
  sharp(sourcePath, getInputOptions({ animated: true })).metadata();

export const isIdentityImageCrop = (
  sourceWidth: number,
  sourceHeight: number,
  params: CropProfileImageParams
) => {
  const rotation = (((params.rotation ?? 0) % 360) + 360) % 360;

  return (
    rotation === 0 &&
    Math.round(params.left) === 0 &&
    Math.round(params.top) === 0 &&
    Math.round(params.width) === sourceWidth &&
    Math.round(params.height) === sourceHeight &&
    params.outputWidth === sourceWidth &&
    params.outputHeight === sourceHeight
  );
};

export const canSkipImageCrop = (
  sourceWidth: number,
  sourceHeight: number,
  params: CropProfileImageParams
) => {
  const rotation = (((params.rotation ?? 0) % 360) + 360) % 360;
  const unchangedImageAlreadyMatchesOutput =
    params.skipProcessingIfUnchanged === true &&
    rotation === 0 &&
    params.outputWidth === sourceWidth &&
    params.outputHeight === sourceHeight;

  return (
    unchangedImageAlreadyMatchesOutput ||
    isIdentityImageCrop(sourceWidth, sourceHeight, params)
  );
};

/**
 * Crops + resizes an image while preserving animation for GIF/WebP.
 *
 * Reads the source with `{ animated: true }` so `extract` operates per frame
 * (libvips treats each animation frame as a page), then outputs an animated
 * WebP. Rotation needs special handling: libvips cannot rotate a multi-page
 * image in one pass, so animated sources are rotated/cropped frame-by-frame
 * and re-joined.
 */
export const cropProfileImageWithInfo = async (
  sourcePath: string,
  params: CropProfileImageParams,
  sourceMetadata?: sharp.Metadata
): Promise<CropProfileImageResult> => {
  const { outputWidth, outputHeight } = params;
  const rotation = (((params.rotation ?? 0) % 360) + 360) % 360;

  const baseMetadata =
    sourceMetadata ?? (await getCropProfileImageMetadata(sourcePath));

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

  if (rotation === 0) {
    // Single pass handles both static and animated inputs.
    return sharp(sourcePath, getInputOptions({ animated: true }))
      .extract(extractRegion)
      .resize(outputWidth, outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 1 })
      .toBuffer({ resolveWithObject: true });
  }

  if (pages === 1) {
    // Rotate to its own buffer first so the extract runs in rotated space
    // (sharp's internal op ordering doesn't guarantee rotate-before-extract
    // when chained directly).
    const rotated = await sharp(sourcePath, getInputOptions())
      .rotate(rotation)
      .toBuffer();

    return sharp(rotated, getInputOptions())
      .extract(extractRegion)
      .resize(outputWidth, outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 1 })
      .toBuffer({ resolveWithObject: true });
  }

  // Animated + rotation: rotate/crop each frame, then re-join.
  const frames: Buffer[] = [];

  for (let page = 0; page < pages; page++) {
    const rotated = await sharp(sourcePath, getInputOptions({ page, pages: 1 }))
      .rotate(rotation)
      .toBuffer();

    frames.push(
      await sharp(rotated, getInputOptions())
        .extract(extractRegion)
        .resize(outputWidth, outputHeight, { fit: "fill" })
        .png()
        .toBuffer()
    );
  }

  return sharp(frames, getInputOptions({ join: { animated: true } }))
    .webp({
      quality: 90,
      effort: 1,
      loop: baseMetadata.loop ?? 0,
      delay: baseMetadata.delay,
    })
    .toBuffer({ resolveWithObject: true });
};

export const cropProfileImageToBuffer = async (
  sourcePath: string,
  params: CropProfileImageParams
): Promise<Buffer> => {
  const { data } = await cropProfileImageWithInfo(sourcePath, params);
  return data;
};
