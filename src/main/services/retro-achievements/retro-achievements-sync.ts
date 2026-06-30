import type {
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserAchievement,
  UserPreferences,
} from "@types";
import { SubscriptionRequiredError, UserNotLoggedInError } from "@shared";

import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { RetroAchievementsClient } from "./retro-achievements-client";

const RA_BADGE_URL = "https://media.retroachievements.org/Badge";

const toMillis = (date?: string) => {
  if (!date) return null;
  const time = new Date(`${date.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(time) ? null : time;
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

export const syncRetroAchievements = async ({
  objectId,
  shop,
  retroAchievementsGameId,
}: SyncRetroAchievementsParams): Promise<UserAchievement[] | null> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const webApiKey = userPreferences?.retroAchievementsWebApiKey;
  const username = userPreferences?.retroAchievementsUsername;

  if (!webApiKey || !username) return null;

  const gameId = await resolveRetroAchievementsGameId(
    objectId,
    shop,
    retroAchievementsGameId
  );

  if (!gameId) return null;

  const data = await RetroAchievementsClient.getGameInfoAndUserProgress({
    username,
    webApiKey,
    raGameId: gameId,
  });

  const remoteAchievements = Object.values(data.Achievements ?? {});

  const cachedAchievements = await gameAchievementsSublevel.get(
    levelKeys.game(shop, objectId)
  );
  const cachedUnlocked = cachedAchievements?.unlockedAchievements ?? [];

  const unlockedByName = new Map<string, UnlockedAchievement>();
  for (const unlocked of cachedUnlocked) {
    unlockedByName.set(unlocked.name.toUpperCase(), unlocked);
  }

  const hardcoreByName = new Map<string, number>();
  let newUnlockCount = 0;

  for (const achievement of remoteAchievements) {
    const name = String(achievement.ID);
    const unlockTime = toMillis(
      achievement.DateEarned ?? achievement.DateEarnedHardcore
    );
    const hardcoreUnlockTime = toMillis(achievement.DateEarnedHardcore);

    if (hardcoreUnlockTime != null) {
      hardcoreByName.set(name.toUpperCase(), hardcoreUnlockTime);
    }

    if (unlockTime != null && !unlockedByName.has(name.toUpperCase())) {
      unlockedByName.set(name.toUpperCase(), { name, unlockTime });
      newUnlockCount += 1;
    }
  }

  const catalogue: SteamAchievement[] = remoteAchievements.map(
    (achievement) => ({
      name: String(achievement.ID),
      displayName: achievement.Title,
      description: achievement.Description,
      icon: `${RA_BADGE_URL}/${achievement.BadgeName}.png`,
      icongray: `${RA_BADGE_URL}/${achievement.BadgeName}_lock.png`,
      hidden: false,
      points: achievement.Points,
    })
  );

  await gameAchievementsSublevel.put(levelKeys.game(shop, objectId), {
    achievements: catalogue,
    unlockedAchievements: Array.from(unlockedByName.values()),
    updatedAt: Date.now(),
    language: cachedAchievements?.language,
  });

  if (newUnlockCount > 0) {
    HydraApi.post(
      `/profile/games/${shop}/${objectId}/retroachievements/sync`,
      undefined,
      { needsSubscription: true }
    ).catch((err) => {
      if (
        err instanceof SubscriptionRequiredError ||
        err instanceof UserNotLoggedInError
      ) {
        return;
      }

      logger.error("Failed to enqueue RetroAchievements sync", err);
    });
  }

  return catalogue
    .map((achievementData) => {
      const unlocked = unlockedByName.get(achievementData.name.toUpperCase());

      return {
        ...achievementData,
        unlocked: Boolean(unlocked),
        unlockTime: unlocked?.unlockTime ?? null,
        hardcoreUnlockTime:
          hardcoreByName.get(achievementData.name.toUpperCase()) ?? null,
        source: "retroachievements" as const,
      };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return b.unlockTime! - a.unlockTime!;
      }
      return Number(a.hidden) - Number(b.hidden);
    });
};
