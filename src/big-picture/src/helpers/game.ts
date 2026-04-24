import type { LibraryGame } from "@types";

export interface GameAchievementProgress {
  label?: string;
  value?: number;
}

export function getGameAchievementProgress(
  game: Pick<LibraryGame, "achievementCount" | "unlockedAchievementCount">
): GameAchievementProgress {
  const achievementCount = game.achievementCount ?? 0;

  if (achievementCount <= 0) {
    return {};
  }

  const unlockedAchievementCount = game.unlockedAchievementCount ?? 0;

  return {
    label: `${unlockedAchievementCount}/${achievementCount}`,
    value: unlockedAchievementCount / achievementCount,
  };
}
