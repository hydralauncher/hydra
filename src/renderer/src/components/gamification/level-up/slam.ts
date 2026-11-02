// "Slam" level-up number, ported from the designer's prototype (v2): an extruded number whose
// body fans out toward a vanishing point below it, grows, holds and slams into place (~2.5 s).
// Body dither is the prototype's default ("No corpo").
import { GAMIFICATION_PALETTE } from "../gamification-art";
import { BAYER_4X4, mixHex } from "../gamification-colors";

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
  END: 58,
};

export const SLAM_SCALE = 0.8;
const FONT = "900 122px 'Noto Sans', system-ui, sans-serif";
const ZOOM = 2.3;
const QUANT_LEVELS = 6;
/** Rate at which the animation walks the keyframe tables above. */
const SLAM_KEYFRAMES_PER_SECOND = 25;
/** Time constants of the hover glow easing in and out. */
const HOVER_IN_SECONDS = 0.24;
const HOVER_OUT_SECONDS = 0.48;
/** Caps the step after a stalled frame so the hover easing does not jump. */
const MAX_FRAME_DELTA_SECONDS = 0.1;
const MAX_PIXEL_RATIO = 2;

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb =>
  [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as Rgb;

const buildLut = (): Rgb[] => {
  const hexes = [
    "#06081a",
    "#0c1236",
    "#151a52",
    "#22237a",
    ...GAMIFICATION_PALETTE.stops
      .slice(1)
      .map((hex) => mixHex(hex, "#000000", 0.1)),
    "#eafcff",
  ];
  const stops = hexes.map(
    (hex, index) =>
      [Math.pow(index / (hexes.length - 1), 0.55), toRgb(hex)] as const
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

  for (let pass = 0; pass < 2; pass++) {
    raw = raw.map((_, i) => {
      const sum = [0, 0, 0];
      let count = 0;
      for (let offset = -7; offset <= 7; offset++) {
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

const smooth = (v: number) => v * v * (3 - 2 * v);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const at = (table: number[], u: number) => {
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
    sum += at(table, Math.max(0, u - SLAM.IGNITE + (i / 5) * 2.2)) * w;
    weight += w;
  }
  return sum / weight;
};

export interface SlamHandle {
  setOffsetY: (offset: number) => void;
  /** Re-reads the canvas size, after the window resizes. */
  resize: () => void;
  /** Jumps straight to the resting frame. */
  skip: () => void;
  stop: () => void;
}

export function runSlam(
  canvas: HTMLCanvasElement,
  text: string,
  reducedMotion: boolean
): SlamHandle {
  const lut = buildLut();
  const ramp = (u: number) =>
    lut[Math.max(0, Math.min(255, Math.round(u * 255)))];
  const css = (color: Rgb) => `rgb(${color[0]},${color[1]},${color[2]})`;

  const mainContext = canvas.getContext("2d")!;
  mainContext.font = FONT;
  const textWidth = mainContext.measureText(text).width;

  // Body buffer at one pixel per 2 CSS px; the upscale without smoothing gives the dither cells.
  const body = document.createElement("canvas");
  let pixelRatio = 1;
  let width = 0;
  let height = 0;
  let bufferScale = 1;
  let lastKey = "";

  const fitToCanvas = () => {
    pixelRatio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    bufferScale = 1 / (2 * pixelRatio);
    body.width = Math.ceil(canvas.width * bufferScale);
    body.height = Math.ceil(canvas.height * bufferScale);
    lastKey = "";
  };
  fitToCanvas();
  const quant = new Uint8ClampedArray(16 * 256);
  for (let k = 0; k < 16; k++) {
    for (let v = 0; v < 256; v++) {
      const q = Math.min(
        1,
        Math.floor(Math.sqrt(v / 255) * QUANT_LEVELS + (k + 0.5) / 16) /
          QUANT_LEVELS
      );
      quant[k * 256 + v] = q * q * 255;
    }
  }

  let offsetY = 0;
  let hover = 0;
  let hoverTarget = 0;
  let last = performance.now();
  const startedAt = last;
  let frame = 0;
  let stopped = false;
  let finished = reducedMotion;

  const onEnter = () => (hoverTarget = 1);
  const onLeave = () => (hoverTarget = 0);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);

  const draw = (u: number) => {
    let ctx: CanvasRenderingContext2D = mainContext;
    const w = at(SLAM.W, u);
    const centerY = at(SLAM.CY, u);
    const depth = at(SLAM.D, u);
    let off = windowed(SLAM.OFF, u);
    let span = windowed(SLAM.SPAN, u);
    let tipp = windowed(SLAM.TIPP, u);
    const ignited = u >= SLAM.IGNITE;
    if (u > SLAM.REST_FROM) {
      const k = smooth(
        clamp01((u - SLAM.REST_FROM) / (SLAM.REST_FULL - SLAM.REST_FROM))
      );
      off += (SLAM.REST[0] - off) * k;
      span += (SLAM.REST[1] - span) * k;
      tipp += (SLAM.REST[2] - tipp) * k;
    }
    off += 0.075 * hover;
    span += 0.06 * hover * Math.sign(span || 1);
    tipp += 0.075 * hover;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width / 1500, height / 1000) * SLAM_SCALE;
    ctx.translate(
      width / 2 - 750 * scale,
      height / 2 - 467.5 * scale + offsetY
    );
    ctx.scale(scale, scale);

    const ws = (w / 726) * ZOOM;
    const wh = 122 * ws;
    const wx = 750 - (textWidth * ws) / 2;
    const wy = 500 + (centerY - 500) * ZOOM * 0.55 - wh / 2;
    const base = wy + wh;
    const vanish = SLAM.VP * wh;
    const strokeWidth = 2 * SLAM.OUTLINE * 122;

    const copy = (fraction: number) => {
      const q = 1 - fraction;
      ctx.save();
      ctx.translate(750, base + vanish);
      ctx.scale(q, q);
      ctx.translate(-750, -(base + vanish));
      ctx.translate(wx, wy);
      ctx.scale(ws, ws);
    };

    // Glow behind the number.
    {
      const k = clamp01(depth / 322);
      const alpha = (0.08 + 0.18 * smooth(k)) * (1 + 0.35 * hover);
      const cx = 750;
      const cy = base + 0.35 * wh;
      const radius = 0.95 * textWidth * ws * (0.75 + 0.45 * k);
      for (const [rm, am, pos] of [
        [2.6, 0.3, 0.62],
        [1.5, 0.42, 0.8],
        [0.85, 0.62, 0.9],
        [0.42, 0.8, 0.97],
      ]) {
        const r = radius * rm;
        const layerAlpha = alpha * am;
        const color = ramp(pos).join(",");
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
    ctx.lineWidth = strokeWidth;

    let bodyContext: CanvasRenderingContext2D | null = null;
    if (ignited && depth > 1) {
      bodyContext = body.getContext("2d")!;
      bodyContext.setTransform(1, 0, 0, 1, 0, 0);
      bodyContext.clearRect(0, 0, body.width, body.height);
      const m = mainContext.getTransform();
      bodyContext.setTransform(
        m.a * bufferScale,
        0,
        0,
        m.d * bufferScale,
        m.e * bufferScale,
        m.f * bufferScale
      );
      bodyContext.font = FONT;
      bodyContext.textBaseline = "alphabetic";
      bodyContext.lineJoin = "miter";
      bodyContext.lineWidth = strokeWidth;
      ctx = bodyContext;

      const copies = Math.min(
        110,
        Math.max(12, Math.ceil((depth / ZOOM) * 0.75))
      );
      for (let i = copies; i >= 0; i--) {
        const offset = (depth * ZOOM * 0.42 * i) / copies;
        const fraction = i / copies;
        copy(offset / vanish);
        let position = off + span * fraction;
        if (fraction > 0.9) {
          position += (tipp - position) * Math.min(1, (fraction - 0.9) / 0.07);
        }
        const color = css(ramp(position));
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.strokeText(text, 0, 122);
        ctx.fillText(text, 0, 122);
        ctx.restore();
      }
    }

    if (bodyContext) {
      // Ordered dither per channel, gamma-spaced steps, then upscaled without smoothing.
      ctx = mainContext;
      const m = mainContext.getTransform();
      const x0 = Math.max(0, Math.floor((m.a * (wx - 40) + m.e) * bufferScale));
      const x1 = Math.min(
        body.width,
        Math.ceil((m.a * (wx + textWidth * ws + 40) + m.e) * bufferScale)
      );
      const y0 = Math.max(0, Math.floor((m.d * (wy - 40) + m.f) * bufferScale));
      const y1 = Math.min(
        body.height,
        Math.ceil((m.d * (base + depth * ZOOM * 0.42 + 40) + m.f) * bufferScale)
      );
      const boxWidth = Math.max(1, x1 - x0);
      const boxHeight = Math.max(1, y1 - y0);
      const image = bodyContext.getImageData(x0, y0, boxWidth, boxHeight);
      const pixels = image.data;
      for (let y = 0; y < boxHeight; y++) {
        const bayerRow = BAYER_4X4[(y + y0) & 3];
        for (let x = 0; x < boxWidth; x++) {
          const i = (y * boxWidth + x) << 2;
          if (!pixels[i + 3]) continue;
          const o = bayerRow[(x + x0) & 3] << 8;
          pixels[i] = quant[o + pixels[i]];
          pixels[i + 1] = quant[o + pixels[i + 1]];
          pixels[i + 2] = quant[o + pixels[i + 2]];
        }
      }
      bodyContext.putImageData(image, x0, y0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        body,
        0,
        0,
        body.width / bufferScale,
        body.height / bufferScale
      );
      ctx.restore();
    }

    // Face.
    copy(0);
    const face = ctx.createLinearGradient(0, 0, 0, 122);
    face.addColorStop(0, "#f4f4fb");
    face.addColorStop(0.18, "#ffffff");
    face.addColorStop(1, "#c9cbe4");
    ctx.fillStyle = face;
    ctx.fillText(text, 0, 122);
    if (ignited) {
      const color = ramp(Math.min(1, off + span * 0.55)).join(",");
      const film = ctx.createLinearGradient(0, 122 * 0.55, 0, 122);
      film.addColorStop(0, `rgba(${color},0)`);
      film.addColorStop(1, `rgba(${color},.3)`);
      ctx.fillStyle = film;
      ctx.fillText(text, 0, 122);
    }
    ctx.restore();
  };

  const loop = (now: number) => {
    if (stopped) return;
    const dt = Math.min(MAX_FRAME_DELTA_SECONDS, (now - last) / 1000);
    last = now;
    hover +=
      (hoverTarget - hover) *
      (1 -
        Math.exp(
          -dt / (hoverTarget > hover ? HOVER_IN_SECONDS : HOVER_OUT_SECONDS)
        ));
    const u = finished
      ? SLAM.END
      : Math.min(
          SLAM.END,
          bridged(((now - startedAt) / 1000) * SLAM_KEYFRAMES_PER_SECOND)
        );
    const key = `${u.toFixed(2)}|${hover.toFixed(3)}|${offsetY}`;
    if (key !== lastKey) {
      lastKey = key;
      draw(u);
    }
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return {
    skip: () => {
      finished = true;
    },
    setOffsetY: (offset) => {
      offsetY = offset;
    },
    resize: fitToCanvas,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
    },
  };
}

/** Vertical layout of tag + number + footer as one centered group (prototype `placeSlam`). */
export function getSlamLayout(
  width: number,
  height: number,
  tagHeight: number,
  footerHeight: number
) {
  const scale = Math.min(width / 1500, height / 1000) * SLAM_SCALE;
  const numberTop = height / 2 + (404 - 467.5) * scale;
  const numberHeight = 284 * scale;
  const gap = 40;
  const tagSpace = tagHeight + 32;
  const total = tagSpace + numberHeight + gap + footerHeight;
  const top = Math.max(16, (height - total) / 2);
  return {
    tagTop: Math.round(top),
    numberOffset: Math.round(top + tagSpace - numberTop),
    footerTop: Math.round(top + tagSpace + numberHeight + gap),
  };
}
