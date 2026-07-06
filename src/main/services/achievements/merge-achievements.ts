import type {
  AchievementNotificationInfo,
  Game,
  GameShop,
  UnlockedAchievement,
  UpdatedUnlockedAchievements,
  UserPreferences,
} from "@types";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { publishNewAchievementNotification } from "../notifications";
import { SubscriptionRequiredError } from "@shared";
import { achievementsLogger } from "../logger";
import {
  db,
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { AchievementWatcherManager } from "./achievement-watcher-manager";
import { createGame } from "../library-sync/create-game";

const isRareAchievement = (points: number) => {
  const rawPercentage = (50 - Math.sqrt(points)) * 2;

  return rawPercentage < 10;
};

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
      await gameAchievementsSublevel.put(levelKey, {
        achievements: gameAchievement?.achievements ?? [],
        unlockedAchievements: unlockedAchievements,
        updatedAt: gameAchievement?.updatedAt,
        language: gameAchievement?.language,
        catalogueValidator: gameAchievement?.catalogueValidator,
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
    });
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  let localGameAchievement = await gameAchievementsSublevel.get(gameKey);
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!localGameAchievement) {
    await getGameAchievementData(game.objectId, game.shop, false);
    localGameAchievement = await gameAchievementsSublevel.get(gameKey);
  }

  const achievementsData = localGameAchievement?.achievements ?? [];
  const unlockedAchievements = localGameAchievement?.unlockedAchievements ?? [];

  const newAchievementsMap = new Map(
    achievements.toReversed().map((achievement) => {
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
    userPreferences.achievementNotificationsEnabled !== false
  ) {
    const filteredAchievements = newAchievements
      .toSorted((a, b) => {
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
      .filter((achievement) => !!achievement);

    const achievementsInfo: AchievementNotificationInfo[] =
      filteredAchievements.map((achievement, index) => {
        return {
          title: achievement.displayName,
          description: achievement.description,
          points: achievement.points,
          isHidden: achievement.hidden,
          isRare: achievement.points
            ? isRareAchievement(achievement.points)
            : false,
          isPlatinum:
            index === filteredAchievements.length - 1 &&
            newAchievements.length + unlockedAchievements.length ===
              achievementsData.length,
          iconUrl: achievement.icon,
        };
      });

    achievementsLogger.log(
      "Publishing achievement notification",
      game.objectId,
      game.title
    );

    const customEnabled =
      userPreferences.achievementCustomNotificationsEnabled !== false &&
      process.platform !== "darwin";

    const position =
      userPreferences.achievementCustomNotificationPosition ?? "top-left";

    const publishOsNotification = () =>
      publishNewAchievementNotification({
        achievements: achievementsInfo,
        unlockedAchievementCount: mergedLocalAchievements.length,
        totalAchievementCount: achievementsData.length,
        gameTitle: game.title,
        gameIcon: game.iconUrl,
      });

    if (process.platform === "linux") {
      const shownInApp =
        customEnabled &&
        WindowManager.sendAchievementToFocusedWindow(
          position,
          achievementsInfo
        );

      if (!shownInApp) {
        publishOsNotification();
      }
    } else {
      const shouldUseCustomNotification =
        customEnabled && !!WindowManager.notificationWindow;

      if (shouldUseCustomNotification) {
        WindowManager.notificationWindow?.webContents.send(
          "on-achievement-unlocked",
          position,
          achievementsInfo
        );
      } else {
        publishOsNotification();
      }
    }
  }

  /* The caller's snapshot may predate the remote registration of the game
     (e.g. one imported from Steam moments ago), so read the latest record
     and, when the game was never registered remotely, register it now —
     without a remoteId achievements can't be synced at all. */
  let syncGame = game;

  if (game.shop !== "custom") {
    const freshGame = await gamesSublevel.get(gameKey).catch(() => null);
    if (freshGame && !freshGame.isDeleted) syncGame = freshGame;

    if (!syncGame.remoteId && HydraApi.isLoggedIn()) {
      await createGame(syncGame).catch(() => {});

      const createdGame = await gamesSublevel.get(gameKey).catch(() => null);
      if (createdGame) syncGame = createdGame;
    }
  }

  const shouldSyncWithRemote =
    syncGame.remoteId &&
    (newAchievements.length || AchievementWatcherManager.hasFinishedPreSearch);

  if (shouldSyncWithRemote) {
    /* Profile stats on a self-hosted cloud server are computed from the
       achievements stored there, but the call below goes to the official
       API whenever there are new achievements — mirror those to the
       self-hosted server so the profile totals include them. */
    if (HydraApi.isSelfHostedCloudEnabled() && newAchievements.length) {
      HydraApi.put(
        "/profile/games/achievements",
        {
          id: syncGame.remoteId,
          objectId: game.objectId,
          shop: game.shop,
          achievements: mergedLocalAchievements,
        },
        { needsSubscription: true }
      ).catch((err) => {
        achievementsLogger.error(
          "Failed to sync achievements with self-hosted cloud",
          game.objectId,
          err
        );
      });
    }

    await HydraApi.put<UpdatedUnlockedAchievements | undefined>(
      "/profile/games/achievements",
      {
        id: syncGame.remoteId,
        /* objectId/shop are ignored by the official API but let a
           self-hosted cloud server key achievements by game */
        objectId: game.objectId,
        shop: game.shop,
        achievements: mergedLocalAchievements,
      },
      { needsSubscription: !newAchievements.length }
    )
      .then((response) => {
        if (response) {
          return saveAchievementsOnLocal(
            response.objectId,
            response.shop,
            response.achievements,
            publishNotification
          );
        }

        return saveAchievementsOnLocal(
          game.objectId,
          game.shop,
          mergedLocalAchievements,
          publishNotification
        );
      })
      .catch((err) => {
        if (err instanceof SubscriptionRequiredError) {
          achievementsLogger.log(
            "Achievements not synchronized on API due to lack of subscription",
            game.objectId,
            game.title
          );
        }

        return saveAchievementsOnLocal(
          game.objectId,
          game.shop,
          mergedLocalAchievements,
          publishNotification
        );
      })
      .finally(() => {
        AchievementWatcherManager.alreadySyncedGames.set(gameKey, true);
      });
  } else if (newAchievements.length) {
    await saveAchievementsOnLocal(
      game.objectId,
      game.shop,
      mergedLocalAchievements,
      publishNotification
    );
  }

  return newAchievements.length;
};
