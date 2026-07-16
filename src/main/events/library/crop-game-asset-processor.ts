import fs from "node:fs";
import sharp from "sharp";

export const MAX_CUSTOM_ARTWORK_SIZE_IN_BYTES = 20 * 1024 * 1024;
export const GAME_ANIMATED_IMAGE_LIMIT_INPUT_PIXELS = 1_000_000_000;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const FAST_PATH_EXTENSIONS: Partial<Record<string, string>> = {
  png: ".png",
  jpeg: ".jpg",
  gif: ".gif",
  webp: ".webp",
};

export interface CropGameAssetParams {
  left: number;
  top: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  rotation?: number;
  skipProcessingIfUnchanged?: boolean;
}

export interface CropGameAssetResult {
  imagePath: string;
  byteLength: number;
  wasProcessed: boolean;
}

export type PrepareAnimatedPngCrop = (
  sourcePath: string,
  params: {
    left: number;
    top: number;
    width: number;
    height: number;
    outputWidth: number;
    outputHeight: number;
    rotation: number;
  }
) => Promise<{ framePaths: string[]; delays: number[]; loopCount: number }>;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getRotation = (rotation = 0) => ((rotation % 360) + 360) % 360;

export const isAnimatedPngFile = async (sourcePath: string) => {
  const handle = await fs.promises.open(sourcePath, "r");

  try {
    const signature = Buffer.alloc(PNG_SIGNATURE.length);
    const signatureRead = await handle.read(signature, 0, signature.length, 0);

    if (
      signatureRead.bytesRead !== signature.length ||
      !signature.equals(PNG_SIGNATURE)
    ) {
      return false;
    }

    const { size } = await handle.stat();
    const chunkHeader = Buffer.alloc(8);
    let offset = PNG_SIGNATURE.length;

    while (offset + chunkHeader.length <= size) {
      const { bytesRead } = await handle.read(
        chunkHeader,
        0,
        chunkHeader.length,
        offset
      );

      if (bytesRead !== chunkHeader.length) return false;

      const chunkSize = chunkHeader.readUInt32BE(0);
      const chunkType = chunkHeader.toString("ascii", 4, 8);

      if (chunkType === "acTL") return true;
      if (chunkType === "IDAT" || chunkType === "IEND") return false;

      offset += 12 + chunkSize;
    }

    return false;
  } finally {
    await handle.close();
  }
};

const getExtractRegion = (
  sourceWidth: number,
  sourceHeight: number,
  params: CropGameAssetParams
) => {
  const rotation = getRotation(params.rotation);
  const isQuarterTurn = rotation === 90 || rotation === 270;
  const frameWidth = isQuarterTurn ? sourceHeight : sourceWidth;
  const frameHeight = isQuarterTurn ? sourceWidth : sourceHeight;
  const left = clamp(Math.round(params.left), 0, frameWidth - 1);
  const top = clamp(Math.round(params.top), 0, frameHeight - 1);

  return {
    left,
    top,
    width: clamp(Math.round(params.width), 1, frameWidth - left),
    height: clamp(Math.round(params.height), 1, frameHeight - top),
  };
};

const processAnimatedPng = async (
  sourcePath: string,
  params: CropGameAssetParams,
  extractRegion: sharp.Region,
  prepare: PrepareAnimatedPngCrop
) => {
  const prepared = await prepare(sourcePath, {
    ...extractRegion,
    outputWidth: params.outputWidth,
    outputHeight: params.outputHeight,
    rotation: getRotation(params.rotation),
  });

  try {
    return await sharp(prepared.framePaths, {
      join: { animated: true },
      limitInputPixels: GAME_ANIMATED_IMAGE_LIMIT_INPUT_PIXELS,
    })
      .webp({
        quality: 90,
        effort: 1,
        loop: prepared.loopCount,
        delay: prepared.delays,
      })
      .toBuffer();
  } finally {
    await Promise.all(
      prepared.framePaths.map((framePath) =>
        fs.promises.unlink(framePath).catch(() => {})
      )
    );
  }
};

const processWithSharp = async (
  sourcePath: string,
  params: CropGameAssetParams,
  metadata: sharp.Metadata,
  extractRegion: sharp.Region,
  animated: boolean
) => {
  const rotation = getRotation(params.rotation);
  const pages = metadata.pages && metadata.pages > 1 ? metadata.pages : 1;
  const inputOptions: sharp.SharpOptions = animated
    ? {
        animated: true,
        limitInputPixels: GAME_ANIMATED_IMAGE_LIMIT_INPUT_PIXELS,
      }
    : {};

  if (rotation === 0) {
    return sharp(sourcePath, inputOptions)
      .extract(extractRegion)
      .resize(params.outputWidth, params.outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 1 })
      .toBuffer();
  }

  if (pages === 1) {
    const rotated = await sharp(sourcePath, {
      limitInputPixels: inputOptions.limitInputPixels,
    })
      .rotate(rotation)
      .toBuffer();

    return sharp(rotated, {
      limitInputPixels: inputOptions.limitInputPixels,
    })
      .extract(extractRegion)
      .resize(params.outputWidth, params.outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 1 })
      .toBuffer();
  }

  const frames: Buffer[] = [];

  for (let page = 0; page < pages; page++) {
    const rotated = await sharp(sourcePath, {
      page,
      pages: 1,
      limitInputPixels: GAME_ANIMATED_IMAGE_LIMIT_INPUT_PIXELS,
    })
      .rotate(rotation)
      .toBuffer();

    frames.push(
      await sharp(rotated, {
        limitInputPixels: GAME_ANIMATED_IMAGE_LIMIT_INPUT_PIXELS,
      })
        .extract(extractRegion)
        .resize(params.outputWidth, params.outputHeight, { fit: "fill" })
        .png()
        .toBuffer()
    );
  }

  return sharp(frames, {
    join: { animated: true },
    limitInputPixels: GAME_ANIMATED_IMAGE_LIMIT_INPUT_PIXELS,
  })
    .webp({
      quality: 90,
      effort: 1,
      loop: metadata.loop ?? 0,
      delay: metadata.delay,
    })
    .toBuffer();
};

export const cropGameAssetToPath = async (
  sourcePath: string,
  outputPathBase: string,
  params: CropGameAssetParams,
  prepare?: PrepareAnimatedPngCrop
): Promise<CropGameAssetResult> => {
  const metadata = await sharp(sourcePath).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.pageHeight ?? metadata.height ?? 0;

  if (!sourceWidth || !sourceHeight || !metadata.format) {
    throw new Error("Could not read source image dimensions");
  }

  const sourceStats = await fs.promises.stat(sourcePath);
  const extension = FAST_PATH_EXTENSIONS[metadata.format];
  const canUseFastPath =
    params.skipProcessingIfUnchanged === true &&
    getRotation(params.rotation) === 0 &&
    params.outputWidth === sourceWidth &&
    params.outputHeight === sourceHeight &&
    sourceStats.size <= MAX_CUSTOM_ARTWORK_SIZE_IN_BYTES &&
    extension !== undefined;

  if (canUseFastPath) {
    const imagePath = `${outputPathBase}${extension}`;
    await fs.promises.copyFile(sourcePath, imagePath);
    return {
      imagePath,
      byteLength: sourceStats.size,
      wasProcessed: false,
    };
  }

  const animatedPng =
    metadata.format === "png" && (await isAnimatedPngFile(sourcePath));
  const animated = animatedPng || Boolean(metadata.pages && metadata.pages > 1);
  const extractRegion = getExtractRegion(sourceWidth, sourceHeight, params);
  if (animatedPng && !prepare) {
    throw new Error("Animated PNG processor is unavailable");
  }

  const buffer =
    animatedPng && prepare
      ? await processAnimatedPng(sourcePath, params, extractRegion, prepare)
      : await processWithSharp(
          sourcePath,
          params,
          metadata,
          extractRegion,
          animated
        );
  const imagePath = `${outputPathBase}.webp`;

  await fs.promises.writeFile(imagePath, buffer);
  return {
    imagePath,
    byteLength: buffer.byteLength,
    wasProcessed: true,
  };
};
