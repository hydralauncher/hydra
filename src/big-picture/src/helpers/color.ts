const DEFAULT_SAMPLE_SIZE = 48;
const DEFAULT_ALPHA_THRESHOLD = 128;
const DEFAULT_QUANTIZATION_STEP = 24;

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

interface DominantColorOptions {
  sampleSize?: number;
  alphaThreshold?: number;
  quantizationStep?: number;
}

interface ColorBucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

const LIGHT_TEXT_COLOR = "var(--primary)";
const DARK_TEXT_COLOR = "var(--background)";

const clampChannel = (value: number) => {
  return Math.max(0, Math.min(255, Math.round(value)));
};

const toHex = (value: number) => {
  return clampChannel(value).toString(16).padStart(2, "0");
};

const rgbToHex = ({ r, g, b }: RGBColor) => {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const quantizeChannel = (value: number, step: number) => {
  return Math.min(255, Math.round(value / step) * step);
};

const normalizeHexColor = (value: string) => {
  const normalizedValue = value.trim().replace(/^#/, "");

  if (/^[\da-f]{3}$/i.test(normalizedValue)) {
    return normalizedValue
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
  }

  if (/^[\da-f]{6}$/i.test(normalizedValue)) {
    return normalizedValue;
  }

  return null;
};

const parseHexColor = (value: string): RGBColor | null => {
  const normalizedValue = normalizeHexColor(value);

  if (!normalizedValue) return null;

  return {
    r: Number.parseInt(normalizedValue.slice(0, 2), 16),
    g: Number.parseInt(normalizedValue.slice(2, 4), 16),
    b: Number.parseInt(normalizedValue.slice(4, 6), 16),
  };
};

const toRelativeLuminance = (channel: number) => {
  const normalizedChannel = channel / 255;

  if (normalizedChannel <= 0.03928) {
    return normalizedChannel / 12.92;
  }

  return ((normalizedChannel + 0.055) / 1.055) ** 2.4;
};

const getContrastRatio = (foreground: RGBColor, background: RGBColor) => {
  const foregroundLuminance =
    0.2126 * toRelativeLuminance(foreground.r) +
    0.7152 * toRelativeLuminance(foreground.g) +
    0.0722 * toRelativeLuminance(foreground.b);
  const backgroundLuminance =
    0.2126 * toRelativeLuminance(background.r) +
    0.7152 * toRelativeLuminance(background.g) +
    0.0722 * toRelativeLuminance(background.b);
  const lighterLuminance = Math.max(foregroundLuminance, backgroundLuminance);
  const darkerLuminance = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighterLuminance + 0.05) / (darkerLuminance + 0.05);
};

export function getContrastTextColor(
  backgroundColor: string | null | undefined
) {
  if (!backgroundColor) return DARK_TEXT_COLOR;

  const background = parseHexColor(backgroundColor);

  if (!background) return DARK_TEXT_COLOR;

  const lightTextContrast = getContrastRatio(
    { r: 255, g: 255, b: 255 },
    background
  );
  const darkTextContrast = getContrastRatio({ r: 8, g: 8, b: 8 }, background);

  return lightTextContrast >= darkTextContrast
    ? LIGHT_TEXT_COLOR
    : DARK_TEXT_COLOR;
}

const loadImage = (src: string) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
};

export async function getDominantColorFromImage(
  imageUrl: string | null | undefined,
  options: DominantColorOptions = {}
) {
  if (!imageUrl) return null;

  const {
    sampleSize = DEFAULT_SAMPLE_SIZE,
    alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
    quantizationStep = DEFAULT_QUANTIZATION_STEP,
  } = options;

  try {
    const image = await loadImage(imageUrl);
    const canvas = globalThis.document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) return null;

    canvas.width = sampleSize;
    canvas.height = sampleSize;
    context.drawImage(image, 0, 0, sampleSize, sampleSize);

    const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
    const buckets = new Map<string, ColorBucket>();

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < alphaThreshold) continue;

      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];

      const key = [
        quantizeChannel(r, quantizationStep),
        quantizeChannel(g, quantizationStep),
        quantizeChannel(b, quantizationStep),
      ].join("-");

      const bucket = buckets.get(key);

      if (bucket) {
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        continue;
      }

      buckets.set(key, {
        count: 1,
        r,
        g,
        b,
      });
    }

    const dominantBucket = Array.from(buckets.values()).sort((a, b) => {
      return b.count - a.count;
    })[0];

    if (!dominantBucket) return null;

    return rgbToHex({
      r: dominantBucket.r / dominantBucket.count,
      g: dominantBucket.g / dominantBucket.count,
      b: dominantBucket.b / dominantBucket.count,
    });
  } catch {
    return null;
  }
}
