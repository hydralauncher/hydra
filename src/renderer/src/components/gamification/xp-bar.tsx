import { useEffect, useRef } from "react";
import { BAR_TRACK_COLOR, BAYER_4X4, rampColor } from "./gamification-colors";
import "./xp-bar.scss";

export interface XpBarProps {
  xp: number;
  xpToNextLevel: number | null;
  /** 0..1: dotted trail after the fill, driven by the hover halo. */
  trail?: number;
  className?: string;
}

const BAR_HEIGHT = 4;
const TRAIL_CELL = 2;

export function XpBar({
  xp,
  xpToNextLevel,
  trail = 0,
  className,
}: Readonly<XpBarProps>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fraction = xpToNextLevel === null ? 1 : Math.min(1, xp / xpToNextLevel);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const draw = () => {
      const width = wrapper.clientWidth;
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(BAR_HEIGHT * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${BAR_HEIGHT}px`;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = BAR_TRACK_COLOR;
      context.fillRect(0, 0, width, BAR_HEIGHT);

      const filled = width * fraction;
      const gradient = context.createLinearGradient(
        0,
        0,
        Math.max(1, filled),
        0
      );
      gradient.addColorStop(0, rampColor(0));
      gradient.addColorStop(0.55, rampColor(0.55));
      gradient.addColorStop(1, rampColor(1));
      context.fillStyle = gradient;
      context.fillRect(0, 0, filled, BAR_HEIGHT);

      if (trail > 0 && fraction < 1) {
        const reach = Math.max(24, width * 0.22) * trail;
        for (
          let x = filled;
          x < Math.min(width, filled + reach);
          x += TRAIL_CELL
        ) {
          for (let y = 0; y < BAR_HEIGHT; y += TRAIL_CELL) {
            const threshold =
              BAYER_4X4[(y / TRAIL_CELL) % 4][Math.floor(x / TRAIL_CELL) % 4];
            if (threshold < (1 - (x - filled) / reach) * 16 * 0.9) {
              context.fillRect(x, y, TRAIL_CELL, TRAIL_CELL);
            }
          }
        }
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [fraction, trail]);

  return (
    <div
      ref={wrapperRef}
      className={`xp-bar ${className ?? ""}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
