import { useEffect, useRef } from "react";
import { GAMIFICATION_PALETTE, LEVEL_SEAL_STAGES } from "./gamification-art";
import { BAYER_4X4, getLevelSealStage, mixHex } from "./gamification-colors";
import { prepareCrispCanvas } from "./pixel-art";

export interface LevelSealProps {
  level: number;
  size: number;
  /** 0..1: dithers the art toward the next stage (hover preview). */
  preview?: number;
  className?: string;
}

const PLATE_BACKGROUND = "#121212";
const SOIL_START_ROW = 12;
const BRIGHT_ART_STAGE = 9;

export function LevelSeal({
  level,
  size,
  preview = 0,
  className,
}: Readonly<LevelSealProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageIndex = getLevelSealStage(level);
  const stage = LEVEL_SEAL_STAGES[stageIndex];
  const nextStage = LEVEL_SEAL_STAGES[stageIndex + 1] ?? null;

  useEffect(() => {
    if (!canvasRef.current) return;

    const artSize = stage.rows.length;
    const cells = artSize + 2;
    const { context, unit } = prepareCrispCanvas(
      canvasRef.current,
      cells,
      size
    );
    if (!context) return;

    const hue = GAMIFICATION_PALETTE.stageHues[stageIndex];
    const palette = {
      rim: mixHex(hue, PLATE_BACKGROUND, 0.38),
      fill: mixHex(hue, PLATE_BACKGROUND, 0.84),
      dither: mixHex(hue, PLATE_BACKGROUND, 0.9),
      art: stageIndex >= BRIGHT_ART_STAGE ? mixHex(hue, "#ffffff", 0.25) : hue,
      detail: mixHex(hue, PLATE_BACKGROUND, 0.5),
    };

    const isCut = (x: number, y: number) =>
      Math.min(
        x + y,
        cells - 1 - x + y,
        x + (cells - 1 - y),
        cells - 1 - x + (cells - 1 - y)
      ) < 2;

    const plateColor = (x: number, y: number) => {
      const isEdge =
        x === 0 ||
        y === 0 ||
        x === cells - 1 ||
        y === cells - 1 ||
        isCut(x - 1, y) ||
        isCut(x + 1, y) ||
        isCut(x, y - 1) ||
        isCut(x, y + 1);
      if (isEdge) return palette.rim;
      return x + y >= cells + 2 && (x + y) % 2 === 0
        ? palette.dither
        : palette.fill;
    };

    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if (isCut(x, y)) continue;

        let color = plateColor(x, y);
        const artX = x - 1;
        const artY = y - 1;
        if (artX >= 0 && artY >= 0 && artX < artSize && artY < artSize) {
          const usesNext =
            nextStage !== null &&
            preview > 0 &&
            BAYER_4X4[artY % 4][artX % 4] < preview * 16;
          const cell = (usesNext ? nextStage.rows : stage.rows)[artY][artX];
          if (cell === "#") {
            color =
              stage.soil && artY >= SOIL_START_ROW
                ? palette.detail
                : palette.art;
          } else if (cell === "+") {
            color = palette.detail;
          }
        }

        context.fillStyle = color;
        context.fillRect(
          Math.round(x * unit),
          Math.round(y * unit),
          Math.ceil(unit),
          Math.ceil(unit)
        );
      }
    }
  }, [stage, nextStage, stageIndex, size, preview]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={stage.name}
    />
  );
}
