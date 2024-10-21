import {
  gameAchievementRepository,
  userPreferencesRepository,
} from "@main/repository";
import { HydraApi } from "../hydra-api";
import type { AchievementData, GameShop } from "@types";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";

export const getGameAchievementData = async (
  objectId: string,
  shop: GameShop
) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  return HydraApi.get<AchievementData[]>("/games/achievements", {
    shop,
    objectId,
    language: userPreferences?.language || "en",
  })
    .then((achievements) => {
      gameAchievementRepository.upsert(
        {
          objectId,
          shop,
          achievements: JSON.stringify(achievements),
        },
        ["objectId", "shop"]
      );

      return achievements;
    })
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) {
        throw err;
      }
      logger.error("Failed to get game achievements", err);
      return gameAchievementRepository
        .findOne({
          where: { objectId, shop },
        })
        .then((gameAchievements) => {
          return JSON.parse(
            gameAchievements?.achievements || "[]"
          ) as AchievementData[];
        });
    });
};
