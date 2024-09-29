import { gameAchievementRepository, gameRepository } from "@main/repository";
import type { GameShop, UnlockedAchievement } from "@types";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";

const saveAchievementsOnLocal = async (
  objectId: string,
  shop: string,
  achievements: any[]
) => {
  return gameAchievementRepository
    .upsert(
      {
        objectId,
        shop,
        unlockedAchievements: JSON.stringify(achievements),
      },
      ["objectId", "shop"]
    )
    .then(() => {
      WindowManager.mainWindow?.webContents.send(
        "on-achievement-unlocked",
        objectId,
        shop
      );
    });
};

export const mergeAchievements = async (
  objectId: string,
  shop: string,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const game = await gameRepository.findOne({
    where: { objectID: objectId, shop: shop as GameShop },
  });

  if (!game) return;

  const localGameAchievement = await gameAchievementRepository.findOne({
    where: {
      objectId,
      shop,
    },
  });

  const unlockedAchievements = JSON.parse(
    localGameAchievement?.unlockedAchievements || "[]"
  );

  const newAchievements = achievements
    .filter((achievement) => {
      return !unlockedAchievements.some((localAchievement) => {
        return localAchievement.name === achievement.name;
      });
    })
    .map((achievement) => {
      return {
        ...achievement,
        unlockTime: achievement.unlockTime * 1000,
      };
    });

  if (newAchievements.length) {
    const achievement = newAchievements.at(-1)!;
    const achievementInfo = JSON.parse(
      localGameAchievement?.achievements || "[]"
    ).find((steamAchievement) => {
      return achievement.name === steamAchievement.name;
    });

    if (publishNotification) {
      WindowManager.notificationWindow?.webContents.send(
        "on-achievement-unlocked",
        objectId,
        shop,
        achievementInfo.displayName,
        achievementInfo.icon
      );

      WindowManager.notificationWindow?.setBounds({ y: 50 });

      setTimeout(() => {
        WindowManager.notificationWindow?.setBounds({ y: -9999 });
      }, 4000);
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
