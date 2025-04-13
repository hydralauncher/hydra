import { HydraApi } from "../hydra-api";
import type { GameShop, SteamAchievement } from "@types";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";

export const getGameAchievementData = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
) => {
  const cachedAchievements = await gameAchievementsSublevel.get(
    levelKeys.game(shop, objectId)
  );

  if (cachedAchievements && useCachedData)
    return cachedAchievements.achievements;

  if (
    cachedAchievements &&
    Date.now() < (cachedAchievements.cacheExpiresTimestamp ?? 0)
  ) {
    return cachedAchievements.achievements;
  }

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf-8",
    })
    .then((language) => language || "en");

  return HydraApi.get<SteamAchievement[]>("/games/achievements", {
    shop,
    objectId,
    language,
  })
    .then(async (achievements) => {
      await gameAchievementsSublevel.put(levelKeys.game(shop, objectId), {
        unlockedAchievements: cachedAchievements?.unlockedAchievements ?? [],
        achievements,
        cacheExpiresTimestamp: Date.now() + 1000 * 60 * 30, // 30 minutes
      });

      return achievements;
    })
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) {
        throw err;
      }

      logger.error("Failed to get game achievements for", objectId, err);

      return [];
    });
};
