// Streak stages (prototype v4.2.0): the flame and the pill fire step up as the streak grows.
export const STREAK_STAGES = [
  { key: "none", minDays: 0 },
  { key: "spark", minDays: 1 },
  { key: "flame", minDays: 7 },
  { key: "bonfire", minDays: 30 },
  { key: "blue_flame", minDays: 100 },
  { key: "legendary_flame", minDays: 365 },
] as const;

export type StreakStage = (typeof STREAK_STAGES)[number];

export function getStreakStageIndex(days: number) {
  return STREAK_STAGES.reduce(
    (found, stage, index) => (days >= stage.minDays ? index : found),
    0
  );
}

// Fire colors per stage: orange up to Bonfire, blue from 100 days, violet from 365.
const FIRE_PALETTES = {
  orange: {
    background: "rgba(255, 90, 60, 0.2)",
    mid: "#ff5a3c",
    hot: "#ffaa36",
    core: "#ffe27a",
  },
  blue: {
    background: "rgba(61, 139, 255, 0.22)",
    mid: "#3d8bff",
    hot: "#7cc4ff",
    core: "#d6f1ff",
  },
  violet: {
    background: "rgba(164, 99, 255, 0.24)",
    mid: "#a463ff",
    hot: "#e08bff",
    core: "#ffd9f6",
  },
} as const;

export function getFirePalette(days: number) {
  const stage = getStreakStageIndex(days);
  if (stage >= 5) return FIRE_PALETTES.violet;
  if (stage === 4) return FIRE_PALETTES.blue;
  return FIRE_PALETTES.orange;
}
