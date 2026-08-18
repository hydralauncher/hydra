const MAX_BLANK_FRAME_CHANNEL_RANGE = 8;

export interface ScreenshotColorRange {
  red: { min: number; max: number };
  green: { min: number; max: number };
  blue: { min: number; max: number };
}

export const isNearlyUniformScreenshot = (range: ScreenshotColorRange) =>
  [range.red, range.green, range.blue].every(
    (channel) => channel.max - channel.min <= MAX_BLANK_FRAME_CHANNEL_RANGE
  );
