type Rgb = [number, number, number];

const PALETTE_STOPS = [
  "#0e6b86",
  "#16b2d6",
  "#3ad1ff",
  "#6a8cff",
  "#8a6cff",
  "#b05cff",
  "#e3a8ff",
];
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const SLAM_SCALE = 0.8;
const FONT = "900 122px 'Noto Sans', system-ui, sans-serif";
const ZOOM = 2.3;
const END_FRAME = 58;
const FRAMES_PER_SECOND = 25;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_FRAME_SECONDS = 0.1;
const HOVER_IN_SECONDS = 0.24;
const HOVER_OUT_SECONDS = 0.48;
const LUT_SMOOTHING_RADIUS = 7;
const LUT_SMOOTHING_PASSES = 2;
const QUANTIZE_LEVELS = 6;
const MIN_EXTRUSION_LAYERS = 12;
const MAX_EXTRUSION_LAYERS = 110;

const SLAM = {
  W: [
    506, 552, 600, 617, 625, 631, 635, 636, 634, 631, 625, 617, 593, 412, 302,
    309, 335, 403, 612, 726, 792, 835, 864, 885, 901, 913, 922, 930, 937, 942,
    946, 950, 952, 952, 949, 937, 919, 904, 870, 476, 519, 545, 582, 611, 621,
    628, 632, 635, 635, 635, 637, 637, 637, 637, 637, 637, 637, 637, 637, 637,
    637,
  ],
  CY: [
    500, 495, 489.5, 487.5, 486.5, 486, 485.5, 485.5, 485.5, 486, 486.5, 487.5,
    492, 515, 532, 529.5, 527, 507.5, 425, 393.5, 378, 367.5, 360, 353, 345,
    338, 332, 328, 324, 321, 318, 316.5, 315.5, 315.5, 316, 320, 325.5, 329,
    341, 545, 540, 513, 499, 491, 487, 485.5, 485.5, 486, 486, 486, 485.5,
    485.5, 485.5, 485.5, 485.5, 485.5, 485.5, 485.5, 485.5, 485.5, 485.5,
  ],
  D: [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 17, 29, 63, 160, 215, 246, 267,
    281, 290, 298, 304, 309, 312, 315, 318, 320, 321, 322, 322, 321, 314, 305,
    291, 259, 47, 44, 50, 56, 60, 63, 65, 66, 66, 66, 66, 67, 67, 67, 67, 67,
    67, 67, 67, 67, 67, 67,
  ],
  OFF: [
    0.784, 0.884, 0.055, 1.031, 0.952, 0.774, 0.65, 0.518, 0.397, 0.312, 0.246,
    0.173, 0.133, 0.001, -0.018, -0.001, -0.024, 0.104, 0.104, 0.104, 0.003,
    -0.003, 0.163, 0.177, 0.15, 0.12, 0.1, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08,
    0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08,
    0.08,
  ],
  SPAN: [
    -0.025, 0.097, 0.635, -0.539, -0.156, 0.117, 0.282, 0.446, 0.578, 0.654,
    0.716, 0.791, 0.806, 0.934, 0.959, 0.925, 0.965, 0.799, 0.799, 0.804, 0.923,
    0.952, 0.768, 0.598, 0.1, 0.06, 0.04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ],
  TIPP: [
    0.756, 0.977, 0.673, 0.37, 0.7, 0.773, 0.845, 0.878, 0.908, 0.932, 0.95,
    0.977, 1.0, 0.977, 0.977, 0.977, 0.977, 0.977, 0.977, 0.977, 0.967, 0.967,
    0.977, 0.87, 0.4, 0.252, 0.252, 0.254, 0.252, 0.252, 0.252, 0.254, 0.252,
    0.252, 0.252, 0.252, 0.252, 0.252, 0.252, 0.252, 0.252, 0.252, 0.252, 0.252,
    0.252, 0.252,
  ],
  IGNITE: 15,
  REST_FROM: 42,
  REST_FULL: 52,
  REST: [0.06, 0.42, 0.62],
  VP: 2.17,
  OUTLINE: 0.084,
  CUT: 38,
  BRIDGE: 5,
};

const parseHex = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const mixHex = (from: string, to: string, amount: number) => {
  const a = parseHex(from);
  const b = parseHex(to);
  return `#${a
    .map((value, index) =>
      Math.round(value + (b[index] - value) * amount)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
};

const buildLut = () => {
  const hexes = [
    "#06081a",
    "#0c1236",
    "#151a52",
    "#22237a",
    ...PALETTE_STOPS.slice(1).map((hex) => mixHex(hex, "#000000", 0.1)),
    "#eafcff",
  ];
  const stops = hexes.map(
    (hex, index) =>
      [Math.pow(index / (hexes.length - 1), 0.55), parseHex(hex)] as const
  );

  let raw: Rgb[] = [];
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let k = stops.length - 2;
    for (let j = 0; j < stops.length - 1; j++) {
      if (u <= stops[j + 1][0]) {
        k = j;
        break;
      }
    }
    const [p0, c0] = stops[k];
    const [p1, c1] = stops[k + 1];
    const t = p1 > p0 ? (u - p0) / (p1 - p0) : 0;
    const eased = t * t * (3 - 2 * t);
    raw.push(c0.map((value, q) => value + (c1[q] - value) * eased) as Rgb);
  }

  for (let pass = 0; pass < LUT_SMOOTHING_PASSES; pass++) {
    raw = raw.map((_, i) => {
      const sum: Rgb = [0, 0, 0];
      let count = 0;
      for (
        let offset = -LUT_SMOOTHING_RADIUS;
        offset <= LUT_SMOOTHING_RADIUS;
        offset++
      ) {
        const color = raw[Math.max(0, Math.min(255, i + offset))];
        sum[0] += color[0];
        sum[1] += color[1];
        sum[2] += color[2];
        count++;
      }
      return sum.map((value) => Math.round(value / count)) as Rgb;
    });
  }
  return raw;
};

const buildQuantizeTable = () => {
  const table = new Uint8ClampedArray(16 * 256);
  for (let k = 0; k < 16; k++) {
    for (let v = 0; v < 256; v++) {
      const q = Math.min(
        1,
        Math.floor(Math.sqrt(v / 255) * QUANTIZE_LEVELS + (k + 0.5) / 16) /
          QUANTIZE_LEVELS
      );
      table[k * 256 + v] = q * q * 255;
    }
  }
  return table;
};

const smoothstep = (value: number) => value * value * (3 - 2 * value);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const sample = (table: number[], u: number) => {
  const last = table.length - 1;
  if (u <= 0) return table[0];
  if (u >= last) return table[last];
  const i = Math.floor(u);
  if (i === SLAM.CUT) return table[i];
  return table[i] + (table[i + 1] - table[i]) * (u - i);
};

const bridged = (u: number) => {
  if (u < SLAM.CUT) return u;
  if (u < SLAM.CUT + 1 + SLAM.BRIDGE) {
    return SLAM.CUT + (1 - Math.pow(1 - (u - SLAM.CUT) / (1 + SLAM.BRIDGE), 3));
  }
  return u - SLAM.BRIDGE;
};

const windowed = (table: number[], u: number) => {
  let sum = 0;
  let weight = 0;
  for (let i = -5; i <= 5; i++) {
    const w = 1 - Math.abs(i) / 6;
    sum += sample(table, Math.max(0, u - SLAM.IGNITE + (i / 5) * 2.2)) * w;
    weight += w;
  }
  return sum / weight;
};

export interface SlamCanvas {
  setOffsetY: (offsetY: number) => void;
  resize: () => void;
  stop: () => void;
}

export const SLAM_NUMBER_TOP = 404;
export const SLAM_NUMBER_HEIGHT = 284;
export const SLAM_CENTER_Y = 467.5;

export const slamScale = (width: number, height: number) =>
  Math.min(width / 1500, height / 1000) * SLAM_SCALE;

export const runSlam = (
  canvas: HTMLCanvasElement,
  text: string
): SlamCanvas => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lut = buildLut();
  const ramp = (u: number) =>
    lut[Math.max(0, Math.min(255, Math.round(u * 255)))];
  const css = (color: Rgb) => `rgb(${color[0]},${color[1]},${color[2]})`;
  const quantize = buildQuantizeTable();

  const mainCtx = canvas.getContext("2d")!;
  mainCtx.font = FONT;
  const textWidth = mainCtx.measureText(text).width;
  const dpr = Math.min(MAX_DEVICE_PIXEL_RATIO, window.devicePixelRatio || 1);
  let width = 0;
  let height = 0;

  const extrusionScale = 1 / (2 * dpr);
  const extrusion = document.createElement("canvas");
  const fitToCanvas = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    extrusion.width = Math.ceil(canvas.width * extrusionScale);
    extrusion.height = Math.ceil(canvas.height * extrusionScale);
  };
  fitToCanvas();

  let offsetY = 0;
  let lastKey = "";
  let hover = 0;
  let hoverTarget = 0;
  let last = performance.now();
  let frame = 0;
  const start = last;

  const onEnter = () => (hoverTarget = 1);
  const onLeave = () => (hoverTarget = 0);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);

  const draw = (u: number) => {
    const wordWidth = sample(SLAM.W, u);
    const wordCenterY = sample(SLAM.CY, u);
    const depth = sample(SLAM.D, u);
    let off = windowed(SLAM.OFF, u);
    let span = windowed(SLAM.SPAN, u);
    let tip = windowed(SLAM.TIPP, u);
    const ignited = u >= SLAM.IGNITE;

    if (u > SLAM.REST_FROM) {
      const k = smoothstep(
        clamp01((u - SLAM.REST_FROM) / (SLAM.REST_FULL - SLAM.REST_FROM))
      );
      off += (SLAM.REST[0] - off) * k;
      span += (SLAM.REST[1] - span) * k;
      tip += (SLAM.REST[2] - tip) * k;
    }
    off += 0.075 * hover;
    span += 0.06 * hover * Math.sign(span || 1);
    tip += 0.075 * hover;

    let ctx = mainCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = slamScale(width, height);
    ctx.translate(
      width / 2 - 750 * scale,
      height / 2 - SLAM_CENTER_Y * scale + offsetY
    );
    ctx.scale(scale, scale);

    const wordScale = (wordWidth / 726) * ZOOM;
    const wordHeight = 122 * wordScale;
    const wordX = 750 - (textWidth * wordScale) / 2;
    const wordY = 500 + (wordCenterY - 500) * ZOOM * 0.55 - wordHeight / 2;
    const base = wordY + wordHeight;
    const vanish = SLAM.VP * wordHeight;
    const stroke = 2 * SLAM.OUTLINE * 122;

    const copy = (fraction: number) => {
      const q = 1 - fraction;
      ctx.save();
      ctx.translate(750, base + vanish);
      ctx.scale(q, q);
      ctx.translate(-750, -(base + vanish));
      ctx.translate(wordX, wordY);
      ctx.scale(wordScale, wordScale);
    };

    {
      const k = clamp01(depth / 322);
      const alpha = (0.08 + 0.18 * smoothstep(k)) * (1 + 0.35 * hover);
      const cx = 750;
      const cy = base + 0.35 * wordHeight;
      const radius = 0.95 * textWidth * wordScale * (0.75 + 0.45 * k);
      for (const [radiusScale, alphaScale, position] of [
        [2.6, 0.3, 0.62],
        [1.5, 0.42, 0.8],
        [0.85, 0.62, 0.9],
        [0.42, 0.8, 0.97],
      ]) {
        const r = radius * radiusScale;
        const layerAlpha = alpha * alphaScale;
        const color = ramp(position);
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        gradient.addColorStop(0, `rgba(${color},${layerAlpha.toFixed(3)})`);
        gradient.addColorStop(
          0.45,
          `rgba(${color},${(layerAlpha * 0.35).toFixed(3)})`
        );
        gradient.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(-1500, -1500, 4500, 4500);
      }
    }

    ctx.font = FONT;
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "miter";
    ctx.lineWidth = stroke;

    let extrusionCtx: CanvasRenderingContext2D | null = null;
    if (ignited && depth > 1) {
      extrusionCtx = extrusion.getContext("2d", { willReadFrequently: true })!;
      extrusionCtx.setTransform(1, 0, 0, 1, 0, 0);
      extrusionCtx.clearRect(0, 0, extrusion.width, extrusion.height);
      const m = mainCtx.getTransform();
      extrusionCtx.setTransform(
        m.a * extrusionScale,
        0,
        0,
        m.d * extrusionScale,
        m.e * extrusionScale,
        m.f * extrusionScale
      );
      extrusionCtx.font = FONT;
      extrusionCtx.textBaseline = "alphabetic";
      extrusionCtx.lineJoin = "miter";
      extrusionCtx.lineWidth = stroke;
      ctx = extrusionCtx;

      const layers = Math.min(
        MAX_EXTRUSION_LAYERS,
        Math.max(MIN_EXTRUSION_LAYERS, Math.ceil((depth / ZOOM) * 0.75))
      );
      for (let i = layers; i >= 0; i--) {
        const layerDepth = (depth * ZOOM * 0.42 * i) / layers;
        const fraction = i / layers;
        copy(layerDepth / vanish);
        let position = off + span * fraction;
        if (fraction > 0.9)
          position += (tip - position) * Math.min(1, (fraction - 0.9) / 0.07);
        const color = css(ramp(position));
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.strokeText(text, 0, 122);
        ctx.fillText(text, 0, 122);
        ctx.restore();
      }
    }

    if (extrusionCtx) {
      ctx = mainCtx;
      const m = mainCtx.getTransform();
      const x0 = Math.max(
        0,
        Math.floor((m.a * (wordX - 40) + m.e) * extrusionScale)
      );
      const x1 = Math.min(
        extrusion.width,
        Math.ceil(
          (m.a * (wordX + textWidth * wordScale + 40) + m.e) * extrusionScale
        )
      );
      const y0 = Math.max(
        0,
        Math.floor((m.d * (wordY - 40) + m.f) * extrusionScale)
      );
      const y1 = Math.min(
        extrusion.height,
        Math.ceil(
          (m.d * (base + depth * ZOOM * 0.42 + 40) + m.f) * extrusionScale
        )
      );
      const boxWidth = Math.max(1, x1 - x0);
      const boxHeight = Math.max(1, y1 - y0);
      const image = extrusionCtx.getImageData(x0, y0, boxWidth, boxHeight);
      const pixels = image.data;
      for (let y = 0; y < boxHeight; y++) {
        const row = BAYER[(y + y0) & 3];
        for (let x = 0; x < boxWidth; x++) {
          const i = (y * boxWidth + x) << 2;
          if (!pixels[i + 3]) continue;
          const o = row[(x + x0) & 3] << 8;
          pixels[i] = quantize[o + pixels[i]];
          pixels[i + 1] = quantize[o + pixels[i + 1]];
          pixels[i + 2] = quantize[o + pixels[i + 2]];
        }
      }
      extrusionCtx.putImageData(image, x0, y0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        extrusion,
        0,
        0,
        extrusion.width / extrusionScale,
        extrusion.height / extrusionScale
      );
      ctx.restore();
    }

    copy(0);
    const face = ctx.createLinearGradient(0, 0, 0, 122);
    face.addColorStop(0, "#f4f4fb");
    face.addColorStop(0.18, "#ffffff");
    face.addColorStop(1, "#c9cbe4");
    ctx.fillStyle = face;
    ctx.fillText(text, 0, 122);
    if (ignited) {
      const color = ramp(Math.min(1, off + span * 0.55));
      const glow = ctx.createLinearGradient(0, 122 * 0.55, 0, 122);
      glow.addColorStop(0, `rgba(${color},0)`);
      glow.addColorStop(1, `rgba(${color},.3)`);
      ctx.fillStyle = glow;
      ctx.fillText(text, 0, 122);
    }
    ctx.restore();
  };

  const loop = (now: number) => {
    if (!canvas.isConnected) return;
    const dt = Math.min(MAX_FRAME_SECONDS, (now - last) / 1000);
    last = now;
    hover +=
      (hoverTarget - hover) *
      (1 -
        Math.exp(
          -dt / (hoverTarget > hover ? HOVER_IN_SECONDS : HOVER_OUT_SECONDS)
        ));
    const u = reduced
      ? END_FRAME
      : Math.min(
          END_FRAME,
          bridged(((now - start) / 1000) * FRAMES_PER_SECOND)
        );
    const key = `${u.toFixed(2)}|${hover.toFixed(3)}`;
    if (key !== lastKey) {
      lastKey = key;
      draw(u);
    }
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return {
    setOffsetY: (value) => {
      offsetY = value;
      lastKey = "";
    },
    resize: () => {
      mainCtx.font = FONT;
      fitToCanvas();
      lastKey = "";
    },
    stop: () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
    },
  };
};
