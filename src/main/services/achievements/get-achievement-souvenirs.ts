import type { GameShop, User, UserAchievement, UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { achievementsLogger } from "@main/services/logger";
import { AchievementSouvenirStore } from "./achievement-souvenir-store";

const fetchAchievementSouvenirs = async (
  objectId: string,
  shop: GameShop,
  language: string
) => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });

  if (!user?.id) return new Map<string, string>();

  const remoteAchievements = await HydraApi.get<UserAchievement[]>(
    `/users/${user.id}/games/achievements`,
    { shop, objectId, language }
  );

  return new Map(
    remoteAchievements
      .filter((achievement) => achievement.imageUrl)
      .map((achievement) => [
        achievement.name.toUpperCase(),
        achievement.imageUrl!,
      ])
  );
};

export const getAchievementSouvenirs = async (
  objectId: string,
  shop: GameShop,
  language?: string
) => {
  const cachedSouvenirs = AchievementSouvenirStore.get(shop, objectId);

  if (cachedSouvenirs) return cachedSouvenirs;

  const resolvedLanguage =
    language ??
    (await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .then((preferences) => preferences?.language ?? "en")
      .catch(() => "en"));

  try {
    const souvenirs = await fetchAchievementSouvenirs(
      objectId,
      shop,
      resolvedLanguage
    );
    AchievementSouvenirStore.set(shop, objectId, souvenirs);

    return souvenirs;
  } catch (error) {
    achievementsLogger.error(
      "Failed to fetch achievement souvenirs",
      objectId,
      error
    );

    return new Map<string, string>();
  }
};
