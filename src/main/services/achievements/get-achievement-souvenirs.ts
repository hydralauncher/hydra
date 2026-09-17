import type {
  GameShop,
  UnlockedAchievement,
  User,
  UserAchievement,
  UserPreferences,
} from "@types";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { achievementsLogger } from "@main/services/logger";
import { AchievementSouvenirStore } from "./achievement-souvenir-store";

export const fetchRemoteUserGameAchievements = async (
  objectId: string,
  shop: GameShop,
  language: string
) => {
  const empty = {
    souvenirs: new Map<string, string>(),
    unlocked: [] as UnlockedAchievement[],
    achievements: [] as UserAchievement[],
  };

  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });

  if (!user?.id) return empty;

  const remoteAchievements = await HydraApi.get<UserAchievement[]>(
    `/users/${user.id}/games/achievements`,
    { shop, objectId, language }
  );

  return {
    souvenirs: new Map(
      remoteAchievements
        .filter((achievement) => achievement.imageUrl)
        .map((achievement) => [
          achievement.name.toUpperCase(),
          achievement.imageUrl!,
        ])
    ),
    unlocked: remoteAchievements.flatMap((achievement) => {
      if (!achievement.name || !achievement.unlockTime) return [];
      return [
        {
          name: achievement.name,
          unlockTime: achievement.unlockTime,
        },
      ];
    }),
    achievements: remoteAchievements,
  };
};

const fetchAchievementSouvenirs = async (
  objectId: string,
  shop: GameShop,
  language: string
) => {
  const remote = await fetchRemoteUserGameAchievements(
    objectId,
    shop,
    language
  );
  return remote.souvenirs;
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
