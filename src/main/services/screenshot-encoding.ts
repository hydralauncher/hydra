import sharp from "sharp";

export const encodeSdrScreenshotJpeg = (input: Buffer, quality: number) =>
  sharp(input)
    .toColourspace("srgb")
    .withIccProfile("srgb")
    .jpeg({ quality })
    .toBuffer();
