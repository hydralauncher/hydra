import {
  gameAchievementRepository,
  userPreferencesRepository,
} from "@main/repository";
import { HydraApi } from "../hydra-api";
import { AchievementData } from "@types";

export const getGameAchievementData = async (
  objectId: string,
  shop: string
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
    .catch(() => {
      return gameAchievementRepository
        .findOne({
          where: { objectId, shop },
        })
        .then((gameAchievements) => {
          return JSON.parse(gameAchievements?.achievements || "[]");
        });
    });
};
