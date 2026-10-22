import { useEffect, useRef } from "react";

export interface PixelArtProps {
  rows: readonly string[];
  colors: Record<string, string>;
  size: number;
  className?: string;
}

export const prepareCrispCanvas = (
  canvas: HTMLCanvasElement,
  cells: number,
  size: number
) => {
  const cellSize = Math.max(1, Math.round(size / cells));
  const pixelRatio = window.devicePixelRatio || 1;
  const cssSize = cells * cellSize;

  canvas.width = cssSize * pixelRatio;
  canvas.height = cssSize * pixelRatio;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;

  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  return { context, unit: cellSize * pixelRatio };
};

export const drawPixelArt = (
  canvas: HTMLCanvasElement,
  rows: readonly string[],
  colors: Record<string, string>,
  size: number
) => {
  const { context, unit } = prepareCrispCanvas(canvas, rows.length, size);
  if (!context) return;

  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = colors[row[x]];
      if (!color) continue;
      context.fillStyle = color;
      context.fillRect(
        Math.round(x * unit),
        Math.round(y * unit),
        Math.ceil(unit),
        Math.ceil(unit)
      );
    }
  });
};

export function PixelArt({
  rows,
  colors,
  size,
  className,
}: Readonly<PixelArtProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawPixelArt(canvasRef.current, rows, colors, size);
  }, [rows, colors, size]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
