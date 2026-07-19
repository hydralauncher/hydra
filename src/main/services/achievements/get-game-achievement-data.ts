import { HydraApi } from "../hydra-api";
import type { GameShop, SteamAchievement } from "@types";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { getSteamLanguage } from "../steam";

const pendingFetches = new Map<string, Promise<SteamAchievement[]>>();

function ensureValidIcons(
  achievements: SteamAchievement[],
  englishAchievements: SteamAchievement[] | null
): SteamAchievement[] {
  return achievements.map((achievement) => {
    let icon = achievement.icon;
    let icongray = achievement.icongray;

    if (!icon || !icongray) {
      const englishMatch = englishAchievements?.find(
        (ea) => ea.name.toUpperCase() === achievement.name.toUpperCase()
      );
      if (englishMatch) {
        if (!icon) icon = englishMatch.icon;
        if (!icongray) icongray = englishMatch.icongray;
      }
    }

    return {
      ...achievement,
      icon: icon || "",
      icongray: icongray || "",
    };
  });
}

export const getGameAchievementData = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
) => {
  if (shop === "custom") {
    return [];
  }

  const gameKey = levelKeys.game(shop, objectId);

  const cachedAchievements = await gameAchievementsSublevel.get(gameKey);

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((language) => language || "en");

  const steamLanguage = getSteamLanguage(language);

  if (
    useCachedData &&
    cachedAchievements?.achievements &&
    cachedAchievements.language === language
  ) {
    return cachedAchievements.achievements;
  }

  const cacheKey = `${shop}:${objectId}:${steamLanguage}`;

  if (pendingFetches.has(cacheKey)) {
    try {
      return await pendingFetches.get(cacheKey)!;
    } catch {
      pendingFetches.delete(cacheKey);
    }
  }

  const fetchPromise = HydraApi.getResponse<SteamAchievement[]>(
    `/games/${shop}/${objectId}/achievements`,
    { language: steamLanguage },
    {
      ifNoneMatch:
        cachedAchievements?.language === language
          ? cachedAchievements.catalogueValidator
          : undefined,
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 304,
    }
  )
    .then(async (response) => {
      if (response.status === 304) {
        return cachedAchievements?.achievements ?? [];
      }

      let achievementsData = response.data;

      if (steamLanguage !== "english") {
        const englishResponse = await HydraApi.getResponse<SteamAchievement[]>(
          `/games/${shop}/${objectId}/achievements`,
          { language: "english" },
          { validateStatus: (s) => s >= 200 && s < 300 }
        ).catch(() => ({ data: null }) as any);

        achievementsData = ensureValidIcons(
          achievementsData,
          englishResponse.data
        );
      }

      await gameAchievementsSublevel.put(gameKey, {
        unlockedAchievements: cachedAchievements?.unlockedAchievements ?? [],
        achievements: achievementsData,
        updatedAt: Date.now(),
        language,
        catalogueValidator:
          typeof response.headers.etag === "string"
            ? response.headers.etag
            : undefined,
      });

      return achievementsData;
    })
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) {
        throw err;
      }

      logger.error("Failed to get game achievements for", objectId, err);

      return cachedAchievements?.achievements ?? [];
    })
    .finally(() => {
      pendingFetches.delete(cacheKey);
    });

  pendingFetches.set(cacheKey, fetchPromise);

  return fetchPromise;
};
