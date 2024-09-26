import { gameAchievementRepository, gameRepository } from "@main/repository";
import { publishNewAchievementNotification } from "../notifications";
import type { GameShop, UnlockedAchievement } from "@types";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";

const saveAchievementsOnLocal = async (
  objectId: string,
  shop: string,
  achievements: any[]
) => {
  return gameAchievementRepository.upsert(
    {
      objectId,
      shop,
      unlockedAchievements: JSON.stringify(achievements),
    },
    ["objectId", "shop"]
  );
};

export const mergeAchievements = async (
  objectId: string,
  shop: string,
  achievements: UnlockedAchievement[]
) => {
  const game = await gameRepository.findOne({
    where: { objectID: objectId, shop: shop as GameShop },
  });

  const localGameAchievement = await gameAchievementRepository.findOne({
    where: {
      objectId,
      shop,
    },
  });

  const unlockedAchievements = JSON.parse(
    localGameAchievement?.unlockedAchievements || "[]"
  );

  const newAchievements = achievements.filter((achievement) => {
    return !unlockedAchievements.some((localAchievement) => {
      return localAchievement.name === achievement.name;
    });
  });

  if (newAchievements.length) {
    WindowManager.mainWindow?.webContents.send(
      "on-achievement-unlocked",
      objectId,
      shop
    );
  }

  for (const achievement of newAchievements.slice(0, 3)) {
    const completeAchievement = JSON.parse(
      localGameAchievement?.achievements || "[]"
    ).find((steamAchievement) => {
      return achievement.name === steamAchievement.name;
    });

    if (completeAchievement) {
      publishNewAchievementNotification(
        game?.title || " ",
        completeAchievement.displayName,
        completeAchievement.icon
      );
    }
  }

  const mergedLocalAchievements = unlockedAchievements.concat(newAchievements);

  if (game?.remoteId) {
    return HydraApi.put("/profile/games/achievements", {
      id: game.remoteId,
      achievements: mergedLocalAchievements,
    })
      .then((response) => {
        return saveAchievementsOnLocal(
          response.objectId,
          response.shop,
          response.achievements
        );
      })
      .catch(() => {
        return saveAchievementsOnLocal(objectId, shop, mergedLocalAchievements);
      });
  }

  return saveAchievementsOnLocal(objectId, shop, mergedLocalAchievements);
};
