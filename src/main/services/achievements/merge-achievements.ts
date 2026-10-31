import type {
  Game,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  User,
  UserPreferences,
} from "@types";
import { achievementSyncCoordinator } from "./achievement-sync-coordinator";
import {
  achievementSyncWorker,
  toAchievementSyncEntry,
} from "./achievement-sync-worker";
import { isAchievementSouvenirsEnabled } from "@shared";
import { randomUUID } from "node:crypto";
import { WindowManager } from "../window-manager";
import { HydraApi } from "../hydra-api";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { achievementsLogger } from "../logger";
import { db, levelKeys } from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { AchievementWatcherManager } from "./achievement-watcher-manager";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { UnlockedAchievementsCache } from "./unlocked-achievements-cache";
import { publishAchievementUnlockNotifications } from "./achievement-unlock-notifications";
import { ScreenshotService } from "../screenshot";
import { PendingAchievementSouvenirStore } from "./pending-achievement-souvenir-store";
import { PendingGroupedSouvenirStore } from "./grouped-souvenir-store";
import { groupedSouvenirWorker } from "./grouped-souvenir-worker";
import { launchedGamePids } from "../launched-game-pids";
import { Wine } from "../wine";

const captureAchievementSouvenirs = async (
  game: Game,
  newAchievements: UnlockedAchievement[],
  achievementsData: SteamAchievement[],
  userPreferences: UserPreferences,
  publishNotification: boolean,
  current: () => boolean
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
    if (!current() || !owner?.id) return null;

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
      achievements: newAchievements.map(toAchievementSyncEntry),
      status: "pending" as const,
      attemptCount: 0,
    };
    if (!current()) throw new Error("achievement-sync-context-changed");
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
  sendUpdateEvent: boolean,
  current: () => boolean = () => true
) => {
  const gameAchievement = AchievementMemoryStore.get(shop, objectId);
  AchievementMemoryStore.set(shop, objectId, {
    achievements: gameAchievement?.achievements ?? [],
    unlockedAchievements,
    language: gameAchievement?.language,
    catalogueValidator: gameAchievement?.catalogueValidator,
  });
  const since = UnlockedAchievementsCache.invalidate(shop, objectId);

  if (!sendUpdateEvent) return;

  return getUnlockedAchievements(objectId, shop, true, current)
    .then((achievements) => {
      if (!current()) return;
      UnlockedAchievementsCache.set(
        shop,
        objectId,
        achievements,
        current,
        since
      );
      WindowManager.mainWindow?.webContents.send(
        `on-update-achievements-${objectId}-${shop}`,
        achievements
      );
    })
    .catch(() => {});
};

const mergeAchievementsLocally = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean,
  current: () => boolean
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
    await getGameAchievementData(game.objectId, game.shop, false, current);
    localGameAchievement = AchievementMemoryStore.get(game.shop, game.objectId);
  }

  if (!current()) throw new Error("achievement-sync-context-changed");
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
    publishNotification,
    current
  );

  if (!current()) throw new Error("achievement-sync-context-changed");
  if (publishNotification) {
    publishAchievementUnlockNotifications({
      game,
      achievements: newAchievements
        .toSorted((a, b) => a.unlockTime - b.unlockTime)
        .map((achievement) =>
          achievementsData.find(
            (steamAchievement) =>
              achievement.name.toUpperCase() ===
              steamAchievement.name.toUpperCase()
          )
        )
        .filter((achievement) => !!achievement),
      completesGame:
        newAchievements.length + unlockedAchievements.length ===
        achievementsData.length,
      unlockedAchievementCount: mergedLocalAchievements.length,
      totalAchievementCount: achievementsData.length,
      userPreferences,
    });
  }

  const achievementsToSync = mergedLocalAchievements;

  const shouldSyncWithRemote =
    Boolean(game.remoteId) && AchievementWatcherManager.hasFinishedPreSearch;

  await saveAchievementsInMemory(
    game.objectId,
    game.shop,
    achievementsToSync,
    publishNotification,
    current
  );
  if (!current()) throw new Error("achievement-sync-context-changed");
  if (shouldSyncWithRemote) {
    const context = HydraApi.getAuthContext();
    if (context)
      await achievementSyncWorker.enqueue({
        context,
        gameKey,
        remoteId: game.remoteId!,
        shop: game.shop,
        objectId: game.objectId,
        achievements: achievementsToSync,
      });
  }

  if (pendingGroupedSouvenir) void groupedSouvenirWorker.trigger();

  return newAchievements.length;
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean
) => {
  if (game.shop === "epic") return 0;
  const context = HydraApi.getAuthContext();
  const current = () =>
    context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null;
  const result = await achievementSyncCoordinator.runMerge(
    levelKeys.game(game.shop, game.objectId),
    (valid) =>
      mergeAchievementsLocally(game, achievements, publishNotification, valid),
    current
  );
  void achievementSyncWorker.trigger();
  return result;
};
