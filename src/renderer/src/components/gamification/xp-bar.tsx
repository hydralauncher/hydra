import { useEffect, useRef } from "react";
import { BAR_TRACK_COLOR, rampColor } from "./gamification-colors";
import "./xp-bar.scss";

export interface XpBarProps {
  xp: number;
  xpToNextLevel: number | null;
  className?: string;
}

const BAR_HEIGHT = 4;

export function XpBar({ xp, xpToNextLevel, className }: Readonly<XpBarProps>) {
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
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [fraction]);

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
