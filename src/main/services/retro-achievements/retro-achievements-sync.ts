import type {
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserAchievement,
  UserPreferences,
} from "@types";
import { UserNotLoggedInError } from "@shared";

import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { getGameAchievementData } from "../achievements/get-game-achievement-data";
import {
  RetroAchievementsClient,
  type RetroAchievementsGameInfoAndUserProgress,
} from "./retro-achievements-client";

const toMillis = (date?: string) => {
  if (!date) return null;
  const time = new Date(`${date.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

const sortAchievements = (a: UserAchievement, b: UserAchievement) => {
  if (a.unlocked && !b.unlocked) return -1;
  if (!a.unlocked && b.unlocked) return 1;
  if (a.unlocked && b.unlocked) {
    return b.unlockTime! - a.unlockTime!;
  }
  return Number(a.hidden) - Number(b.hidden);
};

const buildAchievementsFromCache = async (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  const cached = await gameAchievementsSublevel.get(
    levelKeys.game(shop, objectId)
  );

  if (!cached) return [];

  const unlockedByName = new Map<string, UnlockedAchievement>();
  for (const unlocked of cached.unlockedAchievements ?? []) {
    unlockedByName.set(unlocked.name.toUpperCase(), unlocked);
  }

  return (cached.achievements ?? [])
    .map((achievementData) => {
      const unlocked = unlockedByName.get(achievementData.name.toUpperCase());

      return {
        ...achievementData,
        unlocked: Boolean(unlocked),
        unlockTime: unlocked?.unlockTime ?? null,
        hardcoreUnlockTime: unlocked?.hardcoreUnlockTime ?? null,
        source: "retroachievements" as const,
      };
    })
    .sort(sortAchievements);
};

const resolveRetroAchievementsGameId = async (
  objectId: string,
  shop: GameShop,
  retroAchievementsGameId?: number
) => {
  if (typeof retroAchievementsGameId === "number") {
    return retroAchievementsGameId;
  }

  const game = await HydraApi.get<{
    retroAchievementsGameId: number | null;
  } | null>(`/games/${shop}/${objectId}`, null, { needsAuth: false }).catch(
    () => null
  );

  return game?.retroAchievementsGameId ?? null;
};

interface SyncRetroAchievementsParams {
  objectId: string;
  shop: GameShop;
  retroAchievementsGameId?: number;
}

interface RetroAchievementsSyncResult {
  achievements: UserAchievement[];
  didChange: boolean;
}

const buildRetroAchievementsView = (
  catalogue: SteamAchievement[],
  unlockedByName: Map<string, UnlockedAchievement>
) => {
  return catalogue
    .map((achievementData) => {
      const unlocked = unlockedByName.get(achievementData.name.toUpperCase());

      return {
        ...achievementData,
        unlocked: Boolean(unlocked),
        unlockTime: unlocked?.unlockTime ?? null,
        hardcoreUnlockTime: unlocked?.hardcoreUnlockTime ?? null,
        source: "retroachievements" as const,
      };
    })
    .sort(sortAchievements);
};

export const syncRetroAchievements = async ({
  objectId,
  shop,
  retroAchievementsGameId,
}: SyncRetroAchievementsParams): Promise<RetroAchievementsSyncResult> => {
  const gameKey = levelKeys.game(shop, objectId);

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const webApiKey = userPreferences?.retroAchievementsWebApiKey;
  const username = userPreferences?.retroAchievementsUsername;

  if (!webApiKey || !username) {
    logger.info("RetroAchievements sync skipped: missing credentials", {
      hasWebApiKey: Boolean(webApiKey),
      hasUsername: Boolean(username),
    });
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
    };
  }

  const gameId = await resolveRetroAchievementsGameId(
    objectId,
    shop,
    retroAchievementsGameId
  );

  if (!gameId) {
    logger.info("RetroAchievements sync skipped: no game mapping", {
      objectId,
      shop,
    });
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
    };
  }

  let catalogue: SteamAchievement[];
  try {
    catalogue = await getGameAchievementData(objectId, shop, false);
  } catch (err) {
    logger.error("Failed to fetch RetroAchievements catalogue", err);
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
    };
  }

  let data: RetroAchievementsGameInfoAndUserProgress;
  try {
    data = await RetroAchievementsClient.getGameInfoAndUserProgress({
      username,
      webApiKey,
      raGameId: gameId,
    });
  } catch (err) {
    logger.error("Failed to fetch RetroAchievements progress", err);
    return {
      achievements: await buildAchievementsFromCache(objectId, shop),
      didChange: false,
    };
  }

  const remoteAchievements = Object.values(data.Achievements ?? {});

  const cachedAchievements = await gameAchievementsSublevel.get(gameKey);
  const unlockedByName = new Map<string, UnlockedAchievement>();
  for (const unlocked of cachedAchievements?.unlockedAchievements ?? []) {
    unlockedByName.set(unlocked.name.toUpperCase(), unlocked);
  }

  let newUnlockCount = 0;
  let didChange = false;

  for (const achievement of remoteAchievements) {
    const name = String(achievement.ID);
    const key = name.toUpperCase();
    const unlockTime = toMillis(
      achievement.DateEarned ?? achievement.DateEarnedHardcore
    );
    const hardcoreUnlockTime = toMillis(achievement.DateEarnedHardcore);
    const existing = unlockedByName.get(key);

    if (unlockTime != null && !existing) {
      unlockedByName.set(key, { name, unlockTime, hardcoreUnlockTime });
      newUnlockCount += 1;
      didChange = true;
      continue;
    }

    if (!existing) continue;

    if (existing.unlockTime !== unlockTime && unlockTime != null) {
      unlockedByName.set(key, {
        ...existing,
        unlockTime,
      });
      didChange = true;
    }

    if (
      hardcoreUnlockTime != null &&
      unlockedByName.get(key)?.hardcoreUnlockTime !== hardcoreUnlockTime
    ) {
      unlockedByName.set(key, {
        ...unlockedByName.get(key)!,
        hardcoreUnlockTime,
      });
      didChange = true;
    }
  }

  const achievements = buildRetroAchievementsView(catalogue, unlockedByName);

  await gameAchievementsSublevel.put(gameKey, {
    achievements: catalogue,
    unlockedAchievements: Array.from(unlockedByName.values()),
    updatedAt: cachedAchievements?.updatedAt,
    language: cachedAchievements?.language,
    catalogueValidator: cachedAchievements?.catalogueValidator,
  });

  logger.info("RetroAchievements progress fetched", {
    objectId,
    shop,
    gameId,
    remoteCount: remoteAchievements.length,
    newUnlockCount,
  });

  if (newUnlockCount > 0) {
    HydraApi.post(
      `/profile/games/${shop}/${objectId}/retroachievements/sync`
    ).catch((err) => {
      if (err instanceof UserNotLoggedInError) return;

      logger.error("Failed to enqueue RetroAchievements sync", err);
    });
  }

  return {
    achievements,
    didChange,
  };
};
