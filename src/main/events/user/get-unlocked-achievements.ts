import type { GameShop, User, UserAchievement, UserPreferences } from "@types";
import { registerEvent } from "../register-event";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { db, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { HydraApi } from "@main/services/hydra-api";
import { achievementsLogger } from "@main/services/logger";

const getAchievementSouvenirs = async (
  objectId: string,
  shop: GameShop,
  language: string
) => {
  try {
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
  } catch (error) {
    achievementsLogger.error(
      "Failed to fetch achievement souvenirs",
      objectId,
      error
    );

    return new Map<string, string>();
  }
};

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
): Promise<UserAchievement[]> => {
  const cachedAchievements = AchievementMemoryStore.get(shop, objectId);

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  const showHiddenAchievementsDescription =
    userPreferences?.showHiddenAchievementsDescription || false;

  const achievementsData = await getGameAchievementData(
    objectId,
    shop,
    useCachedData
  );

  const unlockedAchievements = cachedAchievements?.unlockedAchievements ?? [];

  const souvenirs = useCachedData
    ? new Map<string, string>()
    : await getAchievementSouvenirs(
        objectId,
        shop,
        userPreferences?.language ?? "en"
      );

  return achievementsData
    .map((achievementData) => {
      const unlockedAchievementData = unlockedAchievements.find(
        (localAchievement) => {
          return (
            localAchievement.name.toUpperCase() ==
            achievementData.name.toUpperCase()
          );
        }
      );

      const icongray = achievementData.icongray.endsWith("/")
        ? achievementData.icon
        : achievementData.icongray;

      if (unlockedAchievementData) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchievementData.unlockTime,
          imageUrl: souvenirs.get(achievementData.name.toUpperCase()) ?? null,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icongray: icongray,
        description:
          !achievementData.hidden || showHiddenAchievementsDescription
            ? achievementData.description
            : undefined,
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

export const syncAndGetUnlockedAchievements = async (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  await AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);
  return getUnlockedAchievements(objectId, shop, false);
};

const getUnlockedAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  return syncAndGetUnlockedAchievements(objectId, shop);
};

registerEvent("getUnlockedAchievements", getUnlockedAchievementsEvent);
