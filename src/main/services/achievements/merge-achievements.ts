import { userPreferencesRepository } from "@main/repository";
import type { GameShop, UnlockedAchievement } from "@types";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { Game } from "@main/entity";
import { publishNewAchievementNotification } from "../notifications";
import { SubscriptionRequiredError } from "@shared";
import { achievementsLogger } from "../logger";
import { gameAchievementsSublevel, levelKeys } from "@main/level";

const saveAchievementsOnLocal = async (
  objectId: string,
  shop: GameShop,
  unlockedAchievements: UnlockedAchievement[],
  sendUpdateEvent: boolean
) => {
  const levelKey = levelKeys.game(shop, objectId);

  return gameAchievementsSublevel
    .get(levelKey)
    .then(async (gameAchievement) => {
      if (gameAchievement) {
        await gameAchievementsSublevel.put(levelKey, {
          ...gameAchievement,
          unlockedAchievements: unlockedAchievements,
        });

        if (!sendUpdateEvent) return;

        return getUnlockedAchievements(objectId, shop, true)
          .then((achievements) => {
            WindowManager.mainWindow?.webContents.send(
              `on-update-achievements-${objectId}-${shop}`,
              achievements
            );
          })
          .catch(() => {});
      }
    });
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const [localGameAchievement, userPreferences] = await Promise.all([
    gameAchievementsSublevel.get(levelKeys.game(game.shop, game.objectID)),
    userPreferencesRepository.findOne({ where: { id: 1 } }),
  ]);

  const achievementsData = localGameAchievement?.achievements ?? [];
  const unlockedAchievements = localGameAchievement?.unlockedAchievements ?? [];

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
      .filter((achievement) => Boolean(achievement))
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
    await HydraApi.put(
      "/profile/games/achievements",
      {
        id: game.remoteId,
        achievements: mergedLocalAchievements,
      },
      { needsSubscription: !newAchievements.length }
    )
      .then((response) => {
        return saveAchievementsOnLocal(
          response.objectId,
          response.shop,
          response.achievements,
          publishNotification
        );
      })
      .catch((err) => {
        if (err! instanceof SubscriptionRequiredError) {
          achievementsLogger.log(
            "Achievements not synchronized on API due to lack of subscription",
            game.objectID,
            game.title
          );
        }

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
