import type { SaveScene } from "./save-insights-games";

const SCENE_DIRECTORY = "../../../../assets/save-scenes/";
const SCENE_URLS = import.meta.glob<string>(
  "../../../../assets/save-scenes/*.png",
  { eager: true, query: "?url", import: "default" }
);

const assetUrl = (name: string) =>
  SCENE_URLS[`${SCENE_DIRECTORY}${name}.png`] ?? null;

export interface SaveSceneImage {
  key: string;
  image: string;
  overlay: string | null;
  pixelated: boolean;
}

export const resolveSceneImage = (
  scene: SaveScene | null
): SaveSceneImage | null => {
  if (!scene) return null;
  const image = assetUrl(scene.id);
  if (!image) return null;
  return {
    key: `${scene.id}:${scene.overlay ?? ""}`,
    image,
    overlay: scene.overlay ? assetUrl(`overlay-${scene.overlay}`) : null,
    pixelated: true,
  };
};

const BANNER_WIDTH = 272;
const BANNER_HEIGHT = 68;
const PALETTE_SIZE = 16;
const DITHER_SPREAD = 28;
const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
  14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
];

type Color = [number, number, number];

const medianCut = (pixels: Color[], size: number): Color[] => {
  let boxes: Color[][] = [pixels];
  while (boxes.length < size) {
    let widest = -1;
    let channel = 0;
    let index = -1;
    boxes.forEach((box, boxIndex) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let min = 255;
        let max = 0;
        for (const pixel of box) {
          if (pixel[c] < min) min = pixel[c];
          if (pixel[c] > max) max = pixel[c];
        }
        if (max - min > widest) {
          widest = max - min;
          channel = c;
          index = boxIndex;
        }
      }
    });
    if (index < 0) break;
    const box = [...boxes[index]].sort((a, b) => a[channel] - b[channel]);
    const middle = box.length >> 1;
    boxes = [
      ...boxes.slice(0, index),
      box.slice(0, middle),
      box.slice(middle),
      ...boxes.slice(index + 1),
    ];
  }
  return boxes.map((box) => {
    const sum = box.reduce<Color>(
      (total, pixel) => [
        total[0] + pixel[0],
        total[1] + pixel[1],
        total[2] + pixel[2],
      ],
      [0, 0, 0]
    );
    return [
      Math.round(sum[0] / box.length),
      Math.round(sum[1] / box.length),
      Math.round(sum[2] / box.length),
    ];
  });
};

const nearest = (palette: Color[], r: number, g: number, b: number) => {
  let best = palette[0];
  let bestDistance = Infinity;
  for (const color of palette) {
    const distance =
      (color[0] - r) ** 2 + (color[1] - g) ** 2 + (color[2] - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best;
};

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load scene source"));
    image.src = url;
  });

const pixelate = async (url: string) => {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = BANNER_WIDTH;
  canvas.height = BANNER_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const sourceHeight = Math.min(
    image.naturalHeight,
    image.naturalWidth * (BANNER_HEIGHT / BANNER_WIDTH)
  );
  const sourceWidth = sourceHeight * (BANNER_WIDTH / BANNER_HEIGHT);
  context.drawImage(
    image,
    (image.naturalWidth - sourceWidth) / 2,
    (image.naturalHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    0,
    0,
    BANNER_WIDTH,
    BANNER_HEIGHT
  );
  const frame = context.getImageData(0, 0, BANNER_WIDTH, BANNER_HEIGHT);
  const data = frame.data;
  let low = 255;
  let high = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (luma < low) low = luma;
    if (luma > high) high = luma;
  }
  const scale = high > low ? 255 / (high - low) : 1;
  const pixels: Color[] = [];
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, (data[i + c] - low) * scale));
    }
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  const palette = medianCut(pixels, PALETTE_SIZE);
  for (let y = 0; y < BANNER_HEIGHT; y++) {
    for (let x = 0; x < BANNER_WIDTH; x++) {
      const i = (y * BANNER_WIDTH + x) * 4;
      const offset =
        (BAYER_8[(y % 8) * 8 + (x % 8)] / 64 - 0.5) * DITHER_SPREAD;
      const [r, g, b] = nearest(
        palette,
        data[i] + offset,
        data[i + 1] + offset,
        data[i + 2] + offset
      );
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  context.putImageData(frame, 0, 0);
  return canvas.toDataURL("image/png");
};

const pixelatedByUrl = new Map<string, Promise<string | null>>();

/** The shared pixel look for a game whose scenes are not drawn yet: 16 colors, ordered dither. */
export const pixelateHeroImage = (url: string) => {
  let pending = pixelatedByUrl.get(url);
  if (!pending) {
    pending = pixelate(url).catch(() => null);
    pixelatedByUrl.set(url, pending);
  }
  return pending;
};
