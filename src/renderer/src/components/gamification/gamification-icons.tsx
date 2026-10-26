import { useMemo } from "react";
import {
  COIN_ROWS,
  FLAME_CORE_ROWS,
  FLAME_EMBER_ROWS,
  FLAME_ROWS,
  GAMIFICATION_PALETTE,
} from "./gamification-art";
import { DIM_COLOR, mixHex } from "./gamification-colors";
import { PixelArt } from "./pixel-art";
import { getStreakStageIndex } from "./streak-stages";

export function CoinIcon({ size = 16 }: Readonly<{ size?: number }>) {
  const colors = useMemo(
    () => ({
      "#": mixHex(GAMIFICATION_PALETTE.coin, "#ffffff", 0.45),
      "+": GAMIFICATION_PALETTE.coin,
      ":": mixHex(GAMIFICATION_PALETTE.coin, "#000000", 0.45),
    }),
    []
  );

  return <PixelArt rows={COIN_ROWS} colors={colors} size={size} />;
}

// Grid and colors per streak stage: dim, ember, flame, then a flame with a lit core.
const FLAME_STAGE_ART: {
  rows: readonly string[];
  colors: Record<string, string>;
}[] = [
  { rows: FLAME_ROWS, colors: { "#": DIM_COLOR } },
  { rows: FLAME_EMBER_ROWS, colors: { "#": "#d0d1d7" } },
  { rows: FLAME_ROWS, colors: { "#": GAMIFICATION_PALETTE.flame } },
  {
    rows: FLAME_CORE_ROWS,
    colors: { "#": GAMIFICATION_PALETTE.flame, o: "#ffcf4a" },
  },
  { rows: FLAME_CORE_ROWS, colors: { "#": "#3d8bff", o: "#d6f1ff" } },
  { rows: FLAME_CORE_ROWS, colors: { "#": "#a463ff", o: "#ffd9f6" } },
];

export function FlameIcon({
  days,
  size = 12,
}: Readonly<{ days: number; size?: number }>) {
  const { rows, colors } = FLAME_STAGE_ART[getStreakStageIndex(days)];

  return <PixelArt rows={rows} colors={colors} size={size} />;
}
