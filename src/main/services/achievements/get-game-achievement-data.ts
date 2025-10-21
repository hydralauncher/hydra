import { HydraApi } from "../hydra-api";
import type { GameAchievement, GameShop, SteamAchievement } from "@types";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { AxiosError } from "axios";

const getModifiedSinceHeader = (
  cachedAchievements: GameAchievement | undefined,
  userLanguage: string
): Date | undefined => {
  if (!cachedAchievements) {
    return undefined;
  }

  if (userLanguage !== cachedAchievements.language) {
    return undefined;
  }

  return cachedAchievements.updatedAt
    ? new Date(cachedAchievements.updatedAt)
    : undefined;
};

export const getGameAchievementData = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const cachedAchievements = await gameAchievementsSublevel.get(gameKey);

  if (cachedAchievements?.achievements && useCachedData) {
    return cachedAchievements.achievements;
  }

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((language) => language || "en");

  return HydraApi.get<SteamAchievement[]>(
    `/games/${shop}/${objectId}/achievements`,
    {
      language,
    },
    {
      ifModifiedSince: getModifiedSinceHeader(cachedAchievements, language),
    }
  )
    .then(async (achievements) => {
      await gameAchievementsSublevel.put(gameKey, {
        unlockedAchievements: cachedAchievements?.unlockedAchievements ?? [],
        achievements,
        updatedAt: Date.now(),
        language,
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

      return cachedAchievements?.achievements ?? [];
    });
};
