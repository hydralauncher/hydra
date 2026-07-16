import sharp from "sharp";

export interface CropProfileImageParams {
  left: number;
  top: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  rotation?: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const cropProfileImageToBuffer = async (
  sourcePath: string,
  params: CropProfileImageParams
): Promise<Buffer> => {
  const { outputWidth, outputHeight } = params;
  const rotation = (((params.rotation ?? 0) % 360) + 360) % 360;
  const metadata = await sharp(sourcePath, { animated: true }).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.pageHeight ?? metadata.height ?? 0;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("Could not read source image dimensions");
  }

  const isQuarterTurn = rotation === 90 || rotation === 270;
  const frameWidth = isQuarterTurn ? sourceHeight : sourceWidth;
  const frameHeight = isQuarterTurn ? sourceWidth : sourceHeight;
  const extractRegion = {
    left: clamp(Math.round(params.left), 0, frameWidth - 1),
    top: clamp(Math.round(params.top), 0, frameHeight - 1),
    width: 0,
    height: 0,
  };

  extractRegion.width = clamp(
    Math.round(params.width),
    1,
    frameWidth - extractRegion.left
  );
  extractRegion.height = clamp(
    Math.round(params.height),
    1,
    frameHeight - extractRegion.top
  );

  const pages = metadata.pages && metadata.pages > 1 ? metadata.pages : 1;

  if (rotation === 0) {
    return sharp(sourcePath, { animated: true })
      .extract(extractRegion)
      .resize(outputWidth, outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
  }

  if (pages === 1) {
    const rotated = await sharp(sourcePath).rotate(rotation).toBuffer();

    return sharp(rotated)
      .extract(extractRegion)
      .resize(outputWidth, outputHeight, { fit: "fill" })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
  }

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

  return sharp(frames, { join: { animated: true } })
    .webp({
      quality: 90,
      effort: 4,
      loop: metadata.loop ?? 0,
      delay: metadata.delay,
    })
    .toBuffer();
};
