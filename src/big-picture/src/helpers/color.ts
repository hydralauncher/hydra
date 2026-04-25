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

interface HSLColor {
  h: number;
  s: number;
  l: number;
}

interface ColorMetrics {
  saturation: number;
  lightness: number;
  chroma: number;
  value: number;
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

const rgbToHsl = ({ r, g, b }: RGBColor): HSLColor => {
  const normalizedRed = r / 255;
  const normalizedGreen = g / 255;
  const normalizedBlue = b / 255;
  const maxChannel = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const minChannel = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = maxChannel - minChannel;
  const lightness = (maxChannel + minChannel) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;

  switch (maxChannel) {
    case normalizedRed:
      hue = ((normalizedGreen - normalizedBlue) / delta) % 6;
      break;
    case normalizedGreen:
      hue = (normalizedBlue - normalizedRed) / delta + 2;
      break;
    default:
      hue = (normalizedRed - normalizedGreen) / delta + 4;
      break;
  }

  return {
    h: (hue * 60 + 360) % 360,
    s: saturation,
    l: lightness,
  };
};

const hslToRgb = ({ h, s, l }: HSLColor): RGBColor => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hueSegment = h / 60;
  const x = chroma * (1 - Math.abs((hueSegment % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSegment >= 0 && hueSegment < 1) {
    red = chroma;
    green = x;
  } else if (hueSegment < 2) {
    red = x;
    green = chroma;
  } else if (hueSegment < 3) {
    green = chroma;
    blue = x;
  } else if (hueSegment < 4) {
    green = x;
    blue = chroma;
  } else if (hueSegment < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = l - chroma / 2;

  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  };
};

const getColorMetrics = (color: RGBColor): ColorMetrics => {
  const hsl = rgbToHsl(color);
  const maxChannel = Math.max(color.r, color.g, color.b) / 255;
  const minChannel = Math.min(color.r, color.g, color.b) / 255;

  return {
    saturation: hsl.s,
    lightness: hsl.l,
    chroma: (maxChannel - minChannel) * 255,
    value: maxChannel,
  };
};

const boostAccentColor = (color: RGBColor): RGBColor => {
  const hsl = rgbToHsl(color);

  return hslToRgb({
    h: hsl.h,
    s: Math.min(1, Math.max(hsl.s, 0.68)),
    l: Math.max(0.42, Math.min(0.62, hsl.l)),
  });
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

    const bucketEntries = Array.from(buckets.values()).map((bucket) => {
      const color = {
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
      };
      const metrics = getColorMetrics(color);

      return {
        bucket,
        color,
        metrics,
        population: bucket.count / (sampleSize * sampleSize),
      };
    });

    const sortedBucketEntries = bucketEntries.toSorted((a, b) => {
      return b.bucket.count - a.bucket.count;
    });
    const dominantBucket = sortedBucketEntries[0];

    if (!dominantBucket) return null;

    const accentCandidates = sortedBucketEntries.filter((entry) => {
      return (
        entry.population >= 0.015 &&
        entry.metrics.saturation >= 0.22 &&
        entry.metrics.chroma >= 32 &&
        entry.metrics.lightness >= 0.12 &&
        entry.metrics.lightness <= 0.82 &&
        entry.metrics.value >= 0.18
      );
    });

    const accentSafeCandidates = sortedBucketEntries.filter((entry) => {
      return (
        entry.population >= 0.008 &&
        entry.metrics.saturation >= 0.12 &&
        entry.metrics.chroma >= 18 &&
        entry.metrics.lightness >= 0.08 &&
        entry.metrics.lightness <= 0.88
      );
    });

    const sortByVibrancy = (candidates: typeof bucketEntries) => {
      return [...candidates].sort((a, b) => {
        const aLightnessPenalty = Math.abs(a.metrics.lightness - 0.52);
        const bLightnessPenalty = Math.abs(b.metrics.lightness - 0.52);
        const aScore =
          a.metrics.saturation * 4.2 +
          (a.metrics.chroma / 255) * 3.4 +
          a.population * 1.8 -
          aLightnessPenalty * 1.4;
        const bScore =
          b.metrics.saturation * 4.2 +
          (b.metrics.chroma / 255) * 3.4 +
          b.population * 1.8 -
          bLightnessPenalty * 1.4;

        if (bScore !== aScore) return bScore - aScore;
        if (b.population !== a.population) return b.population - a.population;

        return aLightnessPenalty - bLightnessPenalty;
      });
    };

    const selectedEntry =
      sortByVibrancy(accentCandidates)[0] ??
      sortByVibrancy(accentSafeCandidates)[0] ??
      dominantBucket;

    return rgbToHex(boostAccentColor(selectedEntry.color));
  } catch {
    return null;
  }
}
