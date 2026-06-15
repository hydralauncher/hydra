import type { UserAchievement } from "@types";
import { achievementsLogger } from "../logger";
import {
  fetchRetroachievementsGame,
  type RetroachievementAchievement,
} from "./retroachievements-fetcher";

const toUserAchievement = (
  achievement: RetroachievementAchievement,
  unlockedBadgeMap: Map<number, number | null>
): UserAchievement => {
  const unlockTime = unlockedBadgeMap.get(achievement.badgeId) ?? null;
  const unlocked = unlockTime !== null && unlockTime !== undefined;

  return {
    name: String(achievement.id),
    displayName: achievement.title,
    description: achievement.description,
    icon: achievement.badgeUnlockedUrl,
    icongray: achievement.badgeLockedUrl,
    hidden: false,
    points: achievement.points,
    unlocked,
    unlockTime: unlocked ? (unlockTime ?? null) : null,
  };
};

export const mergeRetroachievements = async (
  objectIdOrGameId: string | number,
  apiKey: string,
  username?: string
): Promise<UserAchievement[]> => {
  const gameId =
    typeof objectIdOrGameId === "number"
      ? objectIdOrGameId
      : Number.parseInt(objectIdOrGameId, 10);

  if (!Number.isFinite(gameId)) {
    achievementsLogger.warn(
      `Invalid RetroAchievements game id: ${String(objectIdOrGameId)}`
    );
    return [];
  }

  const gameData = await fetchRetroachievementsGame(gameId, apiKey, username);
  achievementsLogger.debug(
    `Fetched ${gameData?.achievements.length ?? 0} achievements for game ${gameId}`
  );
  if (!gameData) return [];

  const unlockedBadgeMap = new Map<number, number | null>();
  for (const ach of gameData.achievements) {
    if (ach.dateEarned) {
      const ts = Date.parse(ach.dateEarned);
      unlockedBadgeMap.set(ach.badgeId, Number.isFinite(ts) ? ts : null);
    }
  }

  return gameData.achievements.map((achievement) =>
    toUserAchievement(achievement, unlockedBadgeMap)
  );
};
