import {
  gameAchievementRepository,
  userPreferencesRepository,
} from "@main/repository";
import type { AchievementData, GameShop, UnlockedAchievement } from "@types";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { Game } from "@main/entity";
import { achievementsLogger } from "../logger";
import {
  publishCombinedNewAchievementNotification,
  publishNewAchievementNotification,
} from "../notifications";

const saveAchievementsOnLocal = async (
  objectId: string,
  shop: GameShop,
  achievements: any[],
  sendUpdateEvent: boolean
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
      if (!sendUpdateEvent) return;

      return getUnlockedAchievements(objectId, shop, true)
        .then((achievements) => {
          WindowManager.mainWindow?.webContents.send(
            `on-update-achievements-${objectId}-${shop}`,
            achievements
          );
        })
        .catch(() => {});
    });
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const [localGameAchievement, userPreferences] = await Promise.all([
    gameAchievementRepository.findOne({
      where: {
        objectId: game.objectID,
        shop: game.shop,
      },
    }),
    userPreferencesRepository.findOne({ where: { id: 1 } }),
  ]);

  const achievementsData = JSON.parse(
    localGameAchievement?.achievements || "[]"
  ) as AchievementData[];

  const unlockedAchievements = JSON.parse(
    localGameAchievement?.unlockedAchievements || "[]"
  ).filter((achievement) => achievement.name) as UnlockedAchievement[];

  const newAchievementsMap = new Map(
    achievements.reverse().map((achievement) => {
      return [achievement.name.toUpperCase(), achievement];
    })
  );

  const newAchievements = [...newAchievementsMap.values()]
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

  const mergedLocalAchievements = unlockedAchievements.concat(newAchievements);

  if (
    newAchievements.length &&
    publishNotification &&
    userPreferences?.achievementNotificationsEnabled
  ) {
    const achievementsInfo = newAchievements
      .sort((a, b) => {
        return a.unlockTime - b.unlockTime;
      })
      .map((achievement) => {
        return achievementsData.find((steamAchievement) => {
          return (
            achievement.name.toUpperCase() ===
            steamAchievement.name.toUpperCase()
          );
        });
      })
      .filter((achievement) => achievement)
      .map((achievement) => {
        return {
          displayName: achievement!.displayName,
          iconUrl: achievement!.icon,
        };
      });

    publishNewAchievementNotification({
      achievements: achievementsInfo,
      unlockedAchievementCount: mergedLocalAchievements.length,
      totalAchievementCount: achievementsData.length,
      gameTitle: game.title,
      gameIcon: game.iconUrl,
    });
  }

  if (game.remoteId) {
    await HydraApi.put("/profile/games/achievements", {
      id: game.remoteId,
      achievements: mergedLocalAchievements,
    })
      .then((response) => {
        return saveAchievementsOnLocal(
          response.objectId,
          response.shop,
          response.achievements,
          publishNotification
        );
      })
      .catch((err) => {
        achievementsLogger.error(err);

        return saveAchievementsOnLocal(
          game.objectID,
          game.shop,
          mergedLocalAchievements,
          publishNotification
        );
      });
  } else {
    await saveAchievementsOnLocal(
      game.objectID,
      game.shop,
      mergedLocalAchievements,
      publishNotification
    );
  }

  return newAchievements.length;
};
