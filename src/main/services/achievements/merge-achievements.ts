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
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { AchievementWatcherManager } from "./achievement-watcher-manager";
import { ScreenshotService } from "../screenshot";
import { AchievementImageService } from "./achievement-image-service";

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

// Helpers extracted to lower cognitive complexity
const getLocalData = async (game: Game) => {
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

  return {
    achievementsData: localGameAchievement?.achievements ?? [],
    unlockedAchievements: localGameAchievement?.unlockedAchievements ?? [],
    userPreferences,
    gameKey,
  };
};

const computeNewAndMergedAchievements = (
  incoming: UnlockedAchievement[],
  unlockedAchievements: UnlockedAchievement[]
) => {
  const newAchievementsMap = new Map(
    incoming.toReversed().map((achievement) => {
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

  return {
    newAchievements,
    mergedLocalAchievements: unlockedAchievements.concat(newAchievements),
  };
};

const publishAchievementNotificationIfNeeded = (
  game: Game,
  newAchievements: UnlockedAchievement[],
  unlockedAchievements: UnlockedAchievement[],
  achievementsData: any[],
  userPreferences: UserPreferences,
  mergedLocalCount: number,
  publishNotification: boolean
) => {
  if (
    !newAchievements.length ||
    !publishNotification ||
    userPreferences.achievementNotificationsEnabled === false
  ) {
    return;
  }

  const filteredAchievements = newAchievements
    .toSorted((a, b) => a.unlockTime - b.unlockTime)
    .map((achievement) => {
      return achievementsData.find((steamAchievement: any) => {
        return (
          achievement.name.toUpperCase() === steamAchievement.name.toUpperCase()
        );
      });
    })
    .filter((achievement) => !!achievement);

  const achievementsInfo: AchievementNotificationInfo[] =
    filteredAchievements.map((achievement: any, index: number) => {
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

  if (userPreferences.achievementCustomNotificationsEnabled !== false) {
    WindowManager.notificationWindow?.webContents.send(
      "on-achievement-unlocked",
      userPreferences.achievementCustomNotificationPosition ?? "top-left",
      achievementsInfo
    );
  } else {
    publishNewAchievementNotification({
      achievements: achievementsInfo,
      unlockedAchievementCount: mergedLocalCount,
      totalAchievementCount: achievementsData.length,
      gameTitle: game.title,
      gameIcon: game.iconUrl,
    });
  }
};

const addImagesToNewAchievementsIfEnabled = async (
  newAchievements: UnlockedAchievement[],
  achievementsData: any[],
  mergedLocalAchievements: UnlockedAchievement[],
  game: Game,
  userPreferences: UserPreferences
): Promise<UnlockedAchievement[]> => {
  const achievementsWithImages = [...mergedLocalAchievements];

  if (
    !newAchievements.length ||
    userPreferences.enableAchievementScreenshots !== true
  ) {
    return achievementsWithImages;
  }

  try {
    for (const achievement of newAchievements) {
      try {
        const achievementData = achievementsData.find(
          (steamAchievement: any) => {
            return (
              achievement.name.toUpperCase() ===
              steamAchievement.name.toUpperCase()
            );
          }
        );

        const achievementDisplayName =
          achievementData?.displayName || achievement.name;

        const screenshotPath = await ScreenshotService.captureDesktopScreenshot(
          game.title,
          achievementDisplayName
        );

        const uploadResult =
          await AchievementImageService.uploadAchievementImage(
            game.objectId,
            achievement.name,
            screenshotPath
          );

        const achievementIndex = achievementsWithImages.findIndex(
          (a) => a.name.toUpperCase() === achievement.name.toUpperCase()
        );
        if (achievementIndex !== -1 && uploadResult.imageUrl) {
          achievementsWithImages[achievementIndex] = {
            ...achievementsWithImages[achievementIndex],
            imageUrl: uploadResult.imageUrl,
          };
        }
      } catch (error) {
        achievementsLogger.error("Failed to upload achievement image", error);
      }
    }
  } catch (error) {
    achievementsLogger.error(
      "Failed to capture screenshot for achievement",
      error
    );
  }

  return achievementsWithImages;
};

const syncAchievements = async (
  game: Game,
  publishNotification: boolean,
  achievementsWithImages: UnlockedAchievement[],
  newAchievements: UnlockedAchievement[],
  gameKey: string
) => {
  const shouldSyncWithRemote =
    game.remoteId &&
    (newAchievements.length || AchievementWatcherManager.hasFinishedPreSearch);

  if (shouldSyncWithRemote) {
    await HydraApi.put<UpdatedUnlockedAchievements | undefined>(
      "/profile/games/achievements",
      {
        id: game.remoteId,
        achievements: achievementsWithImages,
      },
      { needsSubscription: !newAchievements.length }
    )
      .then(async (response) => {
        if (response) {
          await saveAchievementsOnLocal(
            response.objectId,
            response.shop,
            response.achievements,
            publishNotification
          );
        } else {
          await saveAchievementsOnLocal(
            game.objectId,
            game.shop,
            achievementsWithImages,
            publishNotification
          );
        }
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
          achievementsWithImages,
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
      achievementsWithImages,
      publishNotification
    );
  }
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  const { achievementsData, unlockedAchievements, userPreferences, gameKey } =
    await getLocalData(game);

  const { newAchievements, mergedLocalAchievements } =
    computeNewAndMergedAchievements(achievements, unlockedAchievements);

  publishAchievementNotificationIfNeeded(
    game,
    newAchievements,
    unlockedAchievements,
    achievementsData,
    userPreferences,
    mergedLocalAchievements.length,
    publishNotification
  );

  const achievementsWithImages = await addImagesToNewAchievementsIfEnabled(
    newAchievements,
    achievementsData,
    mergedLocalAchievements,
    game,
    userPreferences
  );

  await syncAchievements(
    game,
    publishNotification,
    achievementsWithImages,
    newAchievements,
    gameKey
  );

  return newAchievements.length;
};
