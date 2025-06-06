import { HydraApi } from "../hydra-api";
import type { GameShop, SteamAchievement } from "@types";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { AxiosError } from "axios";

const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 30; // 30 minutes

export const getGameAchievementData = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const cachedAchievements = await gameAchievementsSublevel.get(gameKey);

  if (cachedAchievements?.achievements && useCachedData)
    return cachedAchievements.achievements;

  if (
    cachedAchievements?.achievements &&
    Date.now() < (cachedAchievements.updatedAt ?? 0) + LOCAL_CACHE_EXPIRATION
  ) {
    return cachedAchievements.achievements;
  }

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((language) => language || "en");

  return HydraApi.get<SteamAchievement[]>(
    "/games/achievements",
    {
      shop,
      objectId,
      language,
    },
    {
      ifModifiedSince: cachedAchievements?.updatedAt
        ? new Date(cachedAchievements?.updatedAt)
        : undefined,
    }
  )
    .then(async (achievements) => {
      await gameAchievementsSublevel.put(gameKey, {
        unlockedAchievements: cachedAchievements?.unlockedAchievements ?? [],
        achievements,
        updatedAt: Date.now() + LOCAL_CACHE_EXPIRATION,
      });

      return achievements;
    })
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) {
        throw err;
      }

      const isNotModified = (err as AxiosError)?.response?.status === 304;

      if (isNotModified) {
        return cachedAchievements?.achievements ?? [];
      }

      logger.error("Failed to get game achievements for", objectId, err);

      return [];
    });
};
