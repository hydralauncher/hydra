import type {
  AchievementNotificationInfo,
  Game,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UpdatedUnlockedAchievements,
  UserPreferences,
} from "@types";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { publishNewAchievementNotification } from "../notifications";
import { achievementsLogger } from "../logger";
import { db, levelKeys } from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { AchievementWatcherManager } from "./achievement-watcher-manager";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { ScreenshotService } from "../screenshot";
import { AchievementImageService } from "./achievement-image-service";

const isRareAchievement = (points: number) => {
  const rawPercentage = (50 - Math.sqrt(points)) * 2;

  return rawPercentage < 10;
};

const captureAchievementSouvenirs = async (
  game: Game,
  newAchievements: UnlockedAchievement[],
  achievementsData: SteamAchievement[]
) => {
  const imageKeysByAchievement = new Map<string, string>();

  for (const achievement of newAchievements) {
    try {
      const displayName =
        achievementsData.find((steamAchievement) => {
          return (
            steamAchievement.name.toUpperCase() ===
            achievement.name.toUpperCase()
          );
        })?.displayName ?? achievement.name;

      const screenshotPath = await ScreenshotService.captureGameScreenshot(
        game.title,
        displayName
      );

      imageKeysByAchievement.set(
        achievement.name.toUpperCase(),
        await AchievementImageService.uploadAchievementImage(screenshotPath)
      );
    } catch (error) {
      achievementsLogger.error(
        "Failed to capture achievement souvenir",
        game.objectId,
        achievement.name,
        error
      );
    }
  }

  await ScreenshotService.cleanupOldScreenshots();

  return imageKeysByAchievement;
};

const withAchievementSouvenirs = async (
  game: Game,
  newAchievements: UnlockedAchievement[],
  mergedLocalAchievements: UnlockedAchievement[],
  achievementsData: SteamAchievement[],
  userPreferences: UserPreferences,
  publishNotification: boolean
) => {
  if (
    !newAchievements.length ||
    !publishNotification ||
    process.platform === "linux" ||
    userPreferences.enableAchievementSouvenirs !== true ||
    !HydraApi.hasActiveSubscription()
  ) {
    return mergedLocalAchievements;
  }

  const imageKeysByAchievement = await captureAchievementSouvenirs(
    game,
    newAchievements,
    achievementsData
  );

  if (!imageKeysByAchievement.size) return mergedLocalAchievements;

  return mergedLocalAchievements.map((achievement) => {
    const imageKey = imageKeysByAchievement.get(achievement.name.toUpperCase());

    return imageKey ? { ...achievement, imageKey } : achievement;
  });
};

const saveAchievementsInMemory = async (
  objectId: string,
  shop: GameShop,
  unlockedAchievements: UnlockedAchievement[],
  sendUpdateEvent: boolean
) => {
  const gameAchievement = AchievementMemoryStore.get(shop, objectId);
  AchievementMemoryStore.set(shop, objectId, {
    achievements: gameAchievement?.achievements ?? [],
    unlockedAchievements,
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
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  let localGameAchievement = AchievementMemoryStore.get(
    game.shop,
    game.objectId
  );
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!localGameAchievement) {
    await getGameAchievementData(game.objectId, game.shop, false);
    localGameAchievement = AchievementMemoryStore.get(game.shop, game.objectId);
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
    } else if (customEnabled) {
      achievementNotificationPresenter.enqueueAchievements(
        position,
        achievementsInfo,
        publishOsNotification
      );
    } else {
      publishOsNotification();
    }
  }

  const achievementsToSync = await withAchievementSouvenirs(
    game,
    newAchievements,
    mergedLocalAchievements,
    achievementsData,
    userPreferences,
    publishNotification
  );

  const shouldSyncWithRemote =
    Boolean(game.remoteId) && AchievementWatcherManager.hasFinishedPreSearch;

  if (shouldSyncWithRemote) {
    await HydraApi.put<UpdatedUnlockedAchievements | undefined>(
      "/profile/games/achievements",
      {
        id: game.remoteId,
        achievements: achievementsToSync,
      }
    )
      .then((response) => {
        AchievementWatcherManager.alreadySyncedGames.set(gameKey, true);

        if (response) {
          return saveAchievementsInMemory(
            response.objectId,
            response.shop,
            response.achievements,
            publishNotification
          );
        }

        return saveAchievementsInMemory(
          game.objectId,
          game.shop,
          achievementsToSync,
          publishNotification
        );
      })
      .catch((err) => {
        AchievementWatcherManager.alreadySyncedGames.delete(gameKey);
        achievementsLogger.error(
          "Failed to reconcile achievements with API",
          game.objectId,
          game.title,
          err
        );

        return saveAchievementsInMemory(
          game.objectId,
          game.shop,
          achievementsToSync,
          publishNotification
        );
      });
  } else if (newAchievements.length) {
    await saveAchievementsInMemory(
      game.objectId,
      game.shop,
      achievementsToSync,
      publishNotification
    );
  }

  return newAchievements.length;
};
