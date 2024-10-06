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
  ).filter((achievement) => achievement.name);

  const newAchievements = achievements
    .filter((achievement) => {
      return !unlockedAchievements.some((localAchievement) => {
        return (
          localAchievement.name.toUpperCase() === achievement.name.toUpperCase()
        );
      });
    })
    .map((achievement) => {
      return {
        name: achievement.name.toUpperCase(),
        unlockTime: achievement.unlockTime,
      };
    });

  if (newAchievements.length && publishNotification) {
    const achievementsInfo = newAchievements
      .sort((a, b) => {
        return a.unlockTime - b.unlockTime;
      })
      .map((achievement) => {
        return JSON.parse(localGameAchievement?.achievements || "[]").find(
          (steamAchievement) => {
            return (
              achievement.name.toUpperCase() ===
              steamAchievement.name.toUpperCase()
            );
          }
        );
      })
      .filter((achievement) => achievement)
      .map((achievement) => {
        return {
          displayName: achievement.displayName,
          iconUrl: achievement.icon,
        };
      });

    WindowManager.notificationWindow?.webContents.send(
      "on-achievement-unlocked",
      objectId,
      shop,
      achievementsInfo
    );
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
