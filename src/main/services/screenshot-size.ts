export const MAX_SCREENSHOT_HEIGHT = 1080;

interface ScreenshotSize {
  width: number;
  height: number;
}

export const fitScreenshotTo1080p = ({
  width,
  height,
}: ScreenshotSize): ScreenshotSize => {
  if (height <= MAX_SCREENSHOT_HEIGHT) return { width, height };

  const scale = MAX_SCREENSHOT_HEIGHT / height;

  return {
    width: Math.round(width * scale),
    height: MAX_SCREENSHOT_HEIGHT,
  };
};
