import type { ScreenshotQuality } from "@types";

export interface ScreenshotSize {
  width: number;
  height: number;
}

export interface ScreenshotBox {
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
  quality: number;
}

export const SCREENSHOT_TIER_BOXES: Record<ScreenshotQuality, ScreenshotBox> = {
  STANDARD: {
    maxWidth: 1280,
    maxHeight: 720,
    maxBytes: 2 * 1024 * 1024,
    quality: 90,
  },
  CLOUD: {
    maxWidth: 1920,
    maxHeight: 1080,
    maxBytes: 5 * 1024 * 1024,
    quality: 95,
  },
};

export const SCREENSHOT_THUMBNAIL_BOX: ScreenshotBox = {
  maxWidth: 480,
  maxHeight: Number.POSITIVE_INFINITY,
  maxBytes: 512 * 1024,
  quality: 80,
};

export const MINIMUM_SCREENSHOT_QUALITY = 50;
export const SCREENSHOT_QUALITY_STEP = 5;

export const fitSizeInsideBox = (
  size: ScreenshotSize,
  box: Pick<ScreenshotBox, "maxWidth" | "maxHeight">
): ScreenshotSize => {
  if (size.width <= 0 || size.height <= 0) {
    throw new RangeError("Screenshot dimensions must be positive");
  }

  const scale = Math.min(
    1,
    box.maxWidth / size.width,
    box.maxHeight / size.height
  );

  if (scale === 1) return { width: size.width, height: size.height };

  return {
    width: Math.min(box.maxWidth, Math.max(1, Math.round(size.width * scale))),
    height: Math.min(
      box.maxHeight,
      Math.max(1, Math.round(size.height * scale))
    ),
  };
};

export const getQualitySteps = (initialQuality: number) => {
  const steps: number[] = [];
  for (
    let quality = initialQuality;
    quality >= MINIMUM_SCREENSHOT_QUALITY;
    quality -= SCREENSHOT_QUALITY_STEP
  ) {
    steps.push(quality);
  }
  return steps;
};

export const encodeWithinByteCap = async (
  encode: (quality: number) => Promise<Buffer>,
  box: Pick<ScreenshotBox, "maxBytes" | "quality">
) => {
  for (const quality of getQualitySteps(box.quality)) {
    const buffer = await encode(quality);
    if (buffer.byteLength <= box.maxBytes) return { buffer, quality };
  }

  throw new Error("screenshot_too_large");
};

const UNDECODABLE_IMAGE_ERROR_PATTERNS = [
  /^Input (buffer|image|file)\b/i,
  /\bVipsForeignLoad\b/i,
  /\b(vipsjpeg|vipspng|libpng|libjpeg|libwebp|libtiff)\b/i,
  /\b(jpeg|png|webp|gif|tiff|heif|bmp|jxl)load/i,
];

const RESOURCE_EXHAUSTION_ERROR_PATTERN = /memory|alloc/i;

export const isUndecodableImageError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (RESOURCE_EXHAUSTION_ERROR_PATTERN.test(message)) return false;
  return UNDECODABLE_IMAGE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
};
