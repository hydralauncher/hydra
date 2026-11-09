export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ImageCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_TOP_TRIM_PIXELS = 200;
const MAX_TOP_TRIM_RATIO = 0.25;
const MAX_BORDER_TRIM_PIXELS = 16;

const rectWidth = (rect: ScreenRect) => rect.right - rect.left;
const rectHeight = (rect: ScreenRect) => rect.bottom - rect.top;

export const getWindowHandleFromSourceId = (sourceId: string) => {
  const match = /^window:([^:]+):/.exec(sourceId);
  if (!match) return null;

  try {
    const handle = BigInt(match[1]);
    return handle > BigInt(0) ? handle.toString() : null;
  } catch {
    return null;
  }
};

export const getClientAreaCrop = (
  frame: ScreenRect | null | undefined,
  client: ScreenRect | null | undefined,
  imageSize: { width: number; height: number }
): ImageCropRect | null => {
  if (!frame || !client) return null;

  const left = Math.max(client.left, frame.left);
  const top = Math.max(client.top, frame.top);
  const right = Math.min(client.right, frame.right);
  const bottom = Math.min(client.bottom, frame.bottom);
  if (right <= left || bottom <= top) return null;

  const topTrim = top - frame.top;
  const maxTopTrim = Math.min(
    MAX_TOP_TRIM_PIXELS,
    rectHeight(frame) * MAX_TOP_TRIM_RATIO
  );
  if (
    topTrim > maxTopTrim ||
    left - frame.left > MAX_BORDER_TRIM_PIXELS ||
    frame.right - right > MAX_BORDER_TRIM_PIXELS ||
    frame.bottom - bottom > MAX_BORDER_TRIM_PIXELS
  ) {
    return null;
  }

  const scaleX = imageSize.width / rectWidth(frame);
  const scaleY = imageSize.height / rectHeight(frame);

  const x = Math.round((left - frame.left) * scaleX);
  const y = Math.round((top - frame.top) * scaleY);
  const width = Math.min(
    imageSize.width - x,
    Math.round((right - left) * scaleX)
  );
  const height = Math.min(
    imageSize.height - y,
    Math.round((bottom - top) * scaleY)
  );

  if (width <= 0 || height <= 0) return null;
  if (
    x === 0 &&
    y === 0 &&
    width === imageSize.width &&
    height === imageSize.height
  ) {
    return null;
  }

  return { x, y, width, height };
};
