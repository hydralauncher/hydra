import { useEffect, useRef } from "react";
import { BAYER_4X4, prefersReducedMotion } from "./gamification-colors";
import { getFirePalette } from "./streak-stages";

/**
 * Streak length where embers show, where they turn into a growing fire, where it
 * starts to glow (the Blue flame stage) and where the pill number starts to shake.
 */
export const STREAK_EMBERS_DAYS = 7;
export const STREAK_FIRE_DAYS = 14;
export const STREAK_GLOW_DAYS = 100;
export const STREAK_HOT_DAYS = 180;

const CELL = 2;
const MAX_HEAT = 36;
// Same fire as the prototype, played slower (it ran at 24 fps with faster tongues).
const FRAME_MS = 1000 / 12;
const TONGUE_SPEED = 0.05;

const fireGrowth = (days: number) =>
  days < STREAK_FIRE_DAYS
    ? 0
    : Math.min(
        1,
        Math.log(days / STREAK_FIRE_DAYS) / Math.log(365 / STREAK_FIRE_DAYS)
      );

interface Spark {
  x: number;
  y: number;
  vy: number;
  dx: number;
  life: number;
}

/**
 * Dithered heat field that rises from the top edge of the streak pill (designer's prototype).
 * Embers from 7 days, a fire that grows with the streak from 14, a glow from 100.
 * The colors follow the streak stage (see streak-stages.ts).
 */
export function StreakFire({ days }: Readonly<{ days: number }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const growth = fireGrowth(days);
    const isEmbers = days < STREAK_FIRE_DAYS;
    const palette = getFirePalette(days);
    const flameHeight = isEmbers ? 14 : Math.round(8 + growth * 20);
    const width = Math.max(40, host.clientWidth);
    const height = Math.round(flameHeight * 1.7) + 8;
    const columns = Math.ceil(width / CELL);
    const rows = Math.ceil(height / CELL);

    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(columns * CELL * pixelRatio);
    canvas.height = Math.round(rows * CELL * pixelRatio);
    canvas.style.width = `${columns * CELL}px`;
    canvas.style.height = `${rows * CELL}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const heat = new Float32Array(columns * rows);
    const tongues = new Float32Array(columns);
    const sparks: Spark[] = [];
    const decay = MAX_HEAT / ((flameHeight / CELL) * (0.45 + growth * 0.4));
    const source = isEmbers ? 0 : MAX_HEAT * (0.6 + 0.4 * growth);
    const reduced = prefersReducedMotion();
    let frame = 0;
    let timer = 0;
    let animationFrame = 0;

    const flameColor = (value: number) => {
      if (value > 0.5) return palette.background;
      if (value > 0.4) return palette.mid;
      if (value > 0.3) return palette.hot;
      return palette.core;
    };

    const sparkColor = (life: number) => {
      if (life > 0.66) return palette.core;
      if (life > 0.33) return palette.hot;
      return palette.mid;
    };

    const step = () => {
      frame++;
      const phase = frame * TONGUE_SPEED;

      for (let x = 0; x < columns; x++) {
        const u = x / (columns - 1);
        const envelope = Math.pow(Math.sin(Math.PI * u), 0.25);
        const tongue =
          0.5 +
          0.5 *
            Math.max(
              Math.sin(u * 9 + phase * 1.3),
              Math.sin(u * 14 - phase * 1.7 + 1),
              Math.sin(u * 5 + phase * 0.6 + 2)
            );
        tongues[x] = envelope * (0.35 + 0.65 * tongue);
        heat[(rows - 1) * columns + x] = source * envelope;
        heat[(rows - 2) * columns + x] = source * envelope;
      }

      for (let y = 0; y < rows - 2; y++) {
        for (let x = 0; x < columns; x++) {
          const drift =
            Math.trunc(Math.random() * 3) - 1 + (Math.random() < 0.3 ? 1 : 0);
          const sourceX = Math.min(columns - 1, Math.max(0, x + drift));
          heat[y * columns + x] = Math.max(
            0,
            heat[(y + 1) * columns + sourceX] -
              Math.random() * decay * (1.1 + 1.8 * (1 - tongues[sourceX]))
          );
        }
      }

      if (Math.random() < (isEmbers ? 0.06 : 0.1 + growth * 0.4)) {
        sparks.push({
          x: 2 + Math.random() * (columns - 4),
          y: rows - 1 - (isEmbers ? 0 : Math.random() * rows * 0.4),
          vy: (isEmbers ? 0.12 : 0.25) + Math.random() * 0.25 + growth * 0.3,
          dx: (Math.random() - 0.5) * 0.3,
          life: 1,
        });
      }

      context.clearRect(0, 0, columns * CELL, rows * CELL);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const value = heat[y * columns + x] / MAX_HEAT;
          if (value <= 0.04) continue;
          if (value < 0.5 && BAYER_4X4[y % 4][x % 4] >= value * 16 * 1.6) {
            continue;
          }
          context.fillStyle = flameColor(value);
          context.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }

      for (let index = sparks.length - 1; index >= 0; index--) {
        const spark = sparks[index];
        spark.y -= spark.vy;
        spark.x += spark.dx;
        spark.life -= 0.02 + (1 - growth) * 0.02;
        if (spark.life <= 0 || spark.y < 0) {
          sparks.splice(index, 1);
          continue;
        }
        const cellX = Math.trunc(spark.x);
        const cellY = Math.trunc(spark.y);
        if (BAYER_4X4[cellY % 4][cellX % 4] < spark.life * 16) {
          context.fillStyle = sparkColor(spark.life);
          context.fillRect(cellX * CELL, cellY * CELL, CELL, CELL);
        }
      }

      if (!reduced) {
        timer = window.setTimeout(() => {
          animationFrame = requestAnimationFrame(step);
        }, FRAME_MS);
      }
    };

    if (reduced) {
      for (let index = 0; index <= rows; index++) step();
    } else {
      step();
    }

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(animationFrame);
    };
  }, [days]);

  return (
    <canvas
      ref={canvasRef}
      className={`streak-fire ${days >= STREAK_GLOW_DAYS ? "streak-fire--glow" : ""}`}
      aria-hidden="true"
    />
  );
}
