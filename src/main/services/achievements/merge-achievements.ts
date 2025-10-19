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

    if (userPreferences.achievementCustomNotificationsEnabled !== false) {
      WindowManager.notificationWindow?.webContents.send(
        "on-achievement-unlocked",
        userPreferences.achievementCustomNotificationPosition ?? "top-left",
        achievementsInfo
      );
    } else {
      publishNewAchievementNotification({
        achievements: achievementsInfo,
        unlockedAchievementCount: mergedLocalAchievements.length,
        totalAchievementCount: achievementsData.length,
        gameTitle: game.title,
        gameIcon: game.iconUrl,
      });
    }
  }

  const shouldSyncWithRemote =
    game.remoteId &&
    (newAchievements.length || AchievementWatcherManager.hasFinishedPreSearch);

  if (shouldSyncWithRemote) {
    await HydraApi.put<UpdatedUnlockedAchievements | undefined>(
      "/profile/games/achievements",
      {
        id: game.remoteId,
        achievements: mergedLocalAchievements,
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
            mergedLocalAchievements,
            publishNotification
          );
        }

        // Capture and upload screenshot AFTER achievements are synced to server
        if (
          newAchievements.length &&
          userPreferences.enableAchievementScreenshots === true
        ) {
          try {
            // Import and trigger the upload process
            const { uploadAchievementImage } = await import(
              "@main/events/achievements/upload-achievement-image"
            );

            // Upload the screenshot for each new achievement
            for (const achievement of newAchievements) {
              try {
                // Find the achievement data to get the display name
                const achievementData = achievementsData.find(
                  (steamAchievement) => {
                    return (
                      achievement.name.toUpperCase() ===
                      steamAchievement.name.toUpperCase()
                    );
                  }
                );

                const achievementDisplayName =
                  achievementData?.displayName || achievement.name;

                // Capture screenshot with game title and achievement name
                const screenshotPath =
                  await ScreenshotService.captureDesktopScreenshot(
                    game.title,
                    achievementDisplayName
                  );

                await uploadAchievementImage(
                  game.objectId,
                  achievement.name,
                  screenshotPath,
                  game.shop
                );
              } catch (error) {
                achievementsLogger.error(
                  "Failed to upload achievement image",
                  error
                );
              }
            }
          } catch (error) {
            achievementsLogger.error(
              "Failed to capture screenshot for achievement",
              error
            );
          }
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
