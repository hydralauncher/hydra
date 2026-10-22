import { useMemo } from "react";
import {
  COIN_ROWS,
  FLAME_ROWS,
  GAMIFICATION_PALETTE,
} from "./gamification-art";
import { DIM_COLOR, mixHex } from "./gamification-colors";
import { PixelArt } from "./pixel-art";

export function CoinIcon({ size = 16 }: Readonly<{ size?: number }>) {
  const colors = useMemo(
    () => ({
      "#": mixHex(GAMIFICATION_PALETTE.b, "#ffffff", 0.45),
      "+": GAMIFICATION_PALETTE.b,
      ":": mixHex(GAMIFICATION_PALETTE.b, "#000000", 0.45),
    }),
    []
  );

  return <PixelArt rows={COIN_ROWS} colors={colors} size={size} />;
}

export function FlameIcon({
  size = 12,
  isDim = false,
}: Readonly<{ size?: number; isDim?: boolean }>) {
  const colors = useMemo(
    () => ({ "#": isDim ? DIM_COLOR : GAMIFICATION_PALETTE.flame }),
    [isDim]
  );

  return <PixelArt rows={FLAME_ROWS} colors={colors} size={size} />;
}
