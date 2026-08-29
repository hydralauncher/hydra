const MAX_BLANK_FRAME_CHANNEL_RANGE = 8;
const MAX_NEAR_BLACK_CHANNEL_VALUE = 16;
const MIN_NEAR_BLACK_PIXEL_RATIO = 0.98;
const MAX_BLACK_FRAME_AVERAGE_CHANNEL_VALUE = 8;

export interface ScreenshotColorRange {
  red: { min: number; max: number };
  green: { min: number; max: number };
  blue: { min: number; max: number };
}

export const getBitmapColorRange = (
  pixels: Uint8Array
): ScreenshotColorRange => {
  const colorRange = {
    red: { min: 255, max: 0 },
    green: { min: 255, max: 0 },
    blue: { min: 255, max: 0 },
  };

  for (let index = 0; index < pixels.length; index += 4) {
    const blue = pixels[index];
    const green = pixels[index + 1];
    const red = pixels[index + 2];

    colorRange.red.min = Math.min(colorRange.red.min, red);
    colorRange.red.max = Math.max(colorRange.red.max, red);
    colorRange.green.min = Math.min(colorRange.green.min, green);
    colorRange.green.max = Math.max(colorRange.green.max, green);
    colorRange.blue.min = Math.min(colorRange.blue.min, blue);
    colorRange.blue.max = Math.max(colorRange.blue.max, blue);
  }

  return colorRange;
};

export const isNearlyUniformScreenshot = (range: ScreenshotColorRange) =>
  [range.red, range.green, range.blue].every(
    (channel) => channel.max - channel.min <= MAX_BLANK_FRAME_CHANNEL_RANGE
  );

export const isMostlyBlackScreenshot = (pixels: Uint8Array) => {
  const pixelCount = Math.floor(pixels.length / 4);
  if (pixelCount === 0) return false;

  let nearBlackPixelCount = 0;
  let channelValueTotal = 0;

  for (let index = 0; index < pixelCount * 4; index += 4) {
    const blue = pixels[index];
    const green = pixels[index + 1];
    const red = pixels[index + 2];

    channelValueTotal += red + green + blue;
    if (
      red <= MAX_NEAR_BLACK_CHANNEL_VALUE &&
      green <= MAX_NEAR_BLACK_CHANNEL_VALUE &&
      blue <= MAX_NEAR_BLACK_CHANNEL_VALUE
    ) {
      nearBlackPixelCount += 1;
    }
  }

  const nearBlackPixelRatio = nearBlackPixelCount / pixelCount;
  const averageChannelValue = channelValueTotal / (pixelCount * 3);

  return (
    nearBlackPixelRatio >= MIN_NEAR_BLACK_PIXEL_RATIO &&
    averageChannelValue <= MAX_BLACK_FRAME_AVERAGE_CHANNEL_VALUE
  );
};
