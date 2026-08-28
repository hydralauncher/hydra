import type {
  AchievementNotificationInfo,
  Game,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UpdatedUnlockedAchievements,
  User,
  UserPreferences,
} from "@types";
import { isAchievementSouvenirsEnabled } from "@shared";
import { randomUUID } from "node:crypto";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { publishNewAchievementNotification } from "../notifications";
import { achievementsLogger } from "../logger";
import { db, levelKeys } from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { mergeUnlockedAchievementLists } from "./merge-unlocked-achievements";
import { AchievementWatcherManager } from "./achievement-watcher-manager";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { achievementNotificationPresenter } from "../achievement-notification-presenter-electron";
import { ScreenshotService } from "../screenshot";
import { PendingAchievementSouvenirStore } from "./pending-achievement-souvenir-store";
import { PendingGroupedSouvenirStore } from "./grouped-souvenir-store";
import { groupedSouvenirWorker } from "./grouped-souvenir-worker";
import { launchedGamePids } from "../launched-game-pids";
import { Wine } from "../wine";
import {
  getGroupedSouvenirErrorCode,
  SOUVENIR_LIMIT_ERROR_CODE,
} from "./grouped-souvenir-retry-policy";

const isRareAchievement = (points: number) => {
  const rawPercentage = (50 - Math.sqrt(points)) * 2;

  return rawPercentage < 10;
};

const captureAchievementSouvenirs = async (
  game: Game,
  newAchievements: UnlockedAchievement[],
  achievementsData: SteamAchievement[],
  userPreferences: UserPreferences,
  publishNotification: boolean
) => {
  if (
    !newAchievements.length ||
    !publishNotification ||
    !game.remoteId ||
    !isAchievementSouvenirsEnabled(
      userPreferences.enableAchievementSouvenirs,
      process.platform
    ) ||
    !HydraApi.hasActiveSubscription()
  ) {
    return null;
  }

  const gameKey = levelKeys.game(game.shop, game.objectId);
  const clientId = randomUUID();
  const capturedAt = Date.now();
  let screenshotPath: string | null = null;

  try {
    const owner = await db.get<string, User>(levelKeys.user, {
      valueEncoding: "json",
    });
    if (!owner?.id) return null;

    const primaryAchievement = newAchievements[0];
    const displayName =
      achievementsData.find(
        (achievement) =>
          achievement.name.toUpperCase() ===
          primaryAchievement.name.toUpperCase()
      )?.displayName ?? primaryAchievement.name;
    const expectedProcessId = launchedGamePids.get(gameKey);

    if (
      !expectedProcessId &&
      process.platform !== "linux" &&
      process.platform !== "win32"
    ) {
      throw new Error("No tracked game process available for screenshot");
    }

    const executablePaths = [
      game.executablePath,
      ...(game.trackingExecutablePaths ?? []),
    ].filter((value): value is string => Boolean(value));
    const effectiveWinePrefixPath =
      process.platform === "linux" &&
      executablePaths.some((value) => value.toLowerCase().endsWith(".exe"))
        ? Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
        : null;
    const resolvedWinePrefixPath = effectiveWinePrefixPath
      ? ((await Wine.resolvePrefixPath(effectiveWinePrefixPath)) ??
        effectiveWinePrefixPath)
      : null;

    screenshotPath = await ScreenshotService.captureGameScreenshot(
      game.title,
      displayName,
      game.remoteId,
      clientId,
      {
        processId: expectedProcessId,
        executablePaths,
        winePrefixPath: resolvedWinePrefixPath,
        gameKey,
      }
    );

    const pending = {
      clientId,
      ownerId: owner.id,
      remoteGameId: game.remoteId,
      gameKey,
      screenshotPath,
      capturedAt,
      achievements: newAchievements.map((achievement) => ({
        name: achievement.name,
        unlockTime: achievement.unlockTime,
        ...(achievement.hardcoreUnlockTime != null && { hardcore: true }),
      })),
      status: "pending" as const,
      attemptCount: 0,
    };
    await PendingGroupedSouvenirStore.put(pending);
    return pending;
  } catch (error) {
    if (screenshotPath) {
      await ScreenshotService.deleteScreenshot(screenshotPath).catch(() => {});
    }
    achievementsLogger.error(
      "Failed to capture grouped achievement souvenir",
      game.objectId,
      newAchievements.map((achievement) => achievement.name),
      error
    );
    return null;
  }
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

interface PublishAchievementUnlockNotificationsOptions {
  game: Game;
  newAchievements: UnlockedAchievement[];
  unlockedAchievements: UnlockedAchievement[];
  achievementsData: SteamAchievement[];
  mergedLocalAchievements: UnlockedAchievement[];
  userPreferences: UserPreferences;
}

const publishAchievementUnlockNotifications = ({
  game,
  newAchievements,
  unlockedAchievements,
  achievementsData,
  mergedLocalAchievements,
  userPreferences,
}: PublishAchievementUnlockNotificationsOptions) => {
  if (
    !newAchievements.length ||
    userPreferences.achievementNotificationsEnabled === false
  ) {
    return;
  }

  const filteredAchievements = newAchievements
    .toSorted((a, b) => {
      return a.unlockTime - b.unlockTime;
    })
    .map((achievement) => {
      return achievementsData.find((steamAchievement) => {
        return (
          achievement.name.toUpperCase() === steamAchievement.name.toUpperCase()
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
      WindowManager.sendAchievementToFocusedWindow(position, achievementsInfo);

    if (!shownInApp) {
      publishOsNotification();
    }
  } else if (customEnabled) {
    // No OS fallback: the user opted into the custom notification, so a failure
    // must not surface as a duplicate system toast.
    achievementNotificationPresenter.enqueueAchievements(
      position,
      achievementsInfo
    );
  } else {
    publishOsNotification();
  }
};

const getAchievementsForSouvenirLimitRetry = (
  error: unknown,
  achievements: UnlockedAchievement[]
) => {
  if (
    getGroupedSouvenirErrorCode(error) !== SOUVENIR_LIMIT_ERROR_CODE ||
    !achievements.some((achievement) => achievement.imageKey)
  ) {
    throw error;
  }

  return achievements.map(
    ({ imageKey: _imageKey, ...achievement }) => achievement
  );
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
        hardcoreUnlockTime: achievement.hardcoreUnlockTime,
      };
    });

  const pendingImageKeys = await PendingAchievementSouvenirStore.get(gameKey);
  const mergedLocalAchievements = unlockedAchievements
    .concat(newAchievements)
    .map((achievement) => {
      const imageKey = pendingImageKeys[achievement.name.toUpperCase()];
      return imageKey ? { ...achievement, imageKey } : achievement;
    });

  const pendingGroupedSouvenir = await captureAchievementSouvenirs(
    game,
    newAchievements,
    achievementsData,
    userPreferences,
    publishNotification
  );

  if (publishNotification) {
    publishAchievementUnlockNotifications({
      game,
      newAchievements,
      unlockedAchievements,
      achievementsData,
      mergedLocalAchievements,
      userPreferences,
    });
  }

  const achievementsToSync = mergedLocalAchievements;

  const shouldSyncWithRemote =
    Boolean(game.remoteId) && AchievementWatcherManager.hasFinishedPreSearch;

  if (shouldSyncWithRemote) {
    let syncedAchievements = achievementsToSync;

    try {
      let response: UpdatedUnlockedAchievements | undefined;

      try {
        response = await HydraApi.put<UpdatedUnlockedAchievements | undefined>(
          "/profile/games/achievements",
          {
            id: game.remoteId,
            achievements: syncedAchievements,
          }
        );
      } catch (error) {
        syncedAchievements = getAchievementsForSouvenirLimitRetry(
          error,
          syncedAchievements
        );
        achievementsLogger.warn(
          "Souvenir limit reached, synchronizing achievements without souvenirs",
          game.objectId,
          game.title
        );
        response = await HydraApi.put<UpdatedUnlockedAchievements | undefined>(
          "/profile/games/achievements",
          {
            id: game.remoteId,
            achievements: syncedAchievements,
          }
        );
      }

      AchievementWatcherManager.alreadySyncedGames.set(gameKey, true);
      await PendingAchievementSouvenirStore.clearSynced(
        gameKey,
        achievementsToSync
      );

      if (response) {
        await saveAchievementsInMemory(
          response.objectId,
          response.shop,
          mergeUnlockedAchievementLists(
            response.achievements,
            syncedAchievements
          ),
          publishNotification
        );
      } else {
        await saveAchievementsInMemory(
          game.objectId,
          game.shop,
          syncedAchievements,
          publishNotification
        );
      }
    } catch (error) {
      AchievementWatcherManager.alreadySyncedGames.delete(gameKey);
      achievementsLogger.error(
        "Failed to reconcile achievements with API",
        game.objectId,
        game.title,
        error
      );

      await saveAchievementsInMemory(
        game.objectId,
        game.shop,
        syncedAchievements,
        publishNotification
      );
    }
  } else if (newAchievements.length) {
    await saveAchievementsInMemory(
      game.objectId,
      game.shop,
      achievementsToSync,
      publishNotification
    );
  }

  if (pendingGroupedSouvenir) void groupedSouvenirWorker.trigger();

  return newAchievements.length;
};
