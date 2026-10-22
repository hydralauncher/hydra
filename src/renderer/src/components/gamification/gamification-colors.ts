import { GAMIFICATION_PALETTE, LEVEL_SEAL_RANGES } from "./gamification-art";

export const DIM_COLOR = "#6b6c72";
export const BAR_TRACK_COLOR = "rgba(255, 255, 255, 0.12)";

export const mixHex = (from: string, to: string, amount: number) => {
  const channels = (hex: string) =>
    [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const a = channels(from);
  const b = channels(to);
  return (
    "#" +
    a
      .map((value, index) =>
        Math.round(value + (b[index] - value) * amount)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
};

export const rampColor = (fraction: number) => {
  const stops = GAMIFICATION_PALETTE.stops.slice(1);
  const position = Math.max(0, Math.min(0.9999, fraction)) * (stops.length - 1);
  const index = Math.floor(position);
  return mixHex(stops[index], stops[index + 1], position - index);
};

export const getLevelSealStage = (level: number) => {
  const stage = LEVEL_SEAL_RANGES.findIndex(
    ([min, max]) => level >= min && level <= max
  );
  return stage === -1 ? LEVEL_SEAL_RANGES.length - 1 : stage;
};
