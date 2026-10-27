import type { AchievementProgress, GameShop, UserAchievement } from "@types";

import { achievementProgressSublevel, levelKeys } from "@main/level";
import { WindowManager } from "../window-manager";

export const ACHIEVEMENT_PROGRESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const getStoredAchievementProgress = (
  shop: GameShop,
  objectId: string
) =>
  achievementProgressSublevel
    .get(levelKeys.game(shop, objectId))
    .then((progress) => progress ?? null)
    .catch(() => null);

export const recordAchievementProgress = async (
  shop: GameShop,
  objectId: string,
  achievements: UserAchievement[]
): Promise<AchievementProgress | null> => {
  if (achievements.length === 0) return null;

  const progress: AchievementProgress = {
    achievementCount: achievements.length,
    unlockedAchievementCount: achievements.filter(
      (achievement) => achievement.unlocked
    ).length,
    updatedAt: Date.now(),
  };

  await achievementProgressSublevel
    .put(levelKeys.game(shop, objectId), progress)
    .catch(() => {});
  WindowManager.sendToAppWindows(
    "on-library-achievement-progress",
    shop,
    objectId,
    progress
  );
  return progress;
};

export const forgetAchievementProgress = (shop: GameShop, objectId: string) =>
  achievementProgressSublevel
    .del(levelKeys.game(shop, objectId))
    .catch(() => {});
