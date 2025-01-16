import { userPreferencesRepository } from "@main/repository";
import { HydraApi } from "../hydra-api";
import type { GameShop, SteamAchievement } from "@types";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { gameAchievementsSublevel, levelKeys } from "@main/level";

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

  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  return HydraApi.get<SteamAchievement[]>("/games/achievements", {
    shop,
    objectId,
    language: userPreferences?.language || "en",
  })
    .then(async (achievements) => {
      await gameAchievementsSublevel.put(levelKeys.game(shop, objectId), {
        unlockedAchievements: cachedAchievements?.unlockedAchievements ?? [],
        achievements,
      });

      return achievements;
    })
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) {
        throw err;
      }

      logger.error("Failed to get game achievements", err);

      return [];
    });
};
