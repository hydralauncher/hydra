import type {
  AchievementData,
  GameShop,
  RemoteUnlockedAchievement,
  UnlockedAchievement,
  UserAchievement,
} from "@types";
import { registerEvent } from "../register-event";
import {
  gameAchievementRepository,
  userPreferencesRepository,
} from "@main/repository";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { HydraApi, logger } from "@main/services";

const getAchievementLocalUser = async (shop: string, objectId: string) => {
  const cachedAchievements = await gameAchievementRepository.findOne({
    where: { objectId, shop },
  });

  const achievementsData: AchievementData[] = cachedAchievements?.achievements
    ? JSON.parse(cachedAchievements.achievements)
    : await getGameAchievementData(objectId, shop);

  const unlockedAchievements = JSON.parse(
    cachedAchievements?.unlockedAchievements || "[]"
  ) as UnlockedAchievement[];

  return achievementsData
    .map((achievementData) => {
      logger.info("unclockedAchievements", unlockedAchievements);

      const unlockedAchiementData = unlockedAchievements.find(
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

      if (unlockedAchiementData) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchiementData.unlockTime,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icon: icongray,
      } as UserAchievement;
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

const getAchievementsRemoteUser = async (
  shop: string,
  objectId: string,
  userId: string
) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  const cachedAchievements = await gameAchievementRepository.findOne({
    where: { objectId, shop },
  });

  const achievementsData: AchievementData[] = cachedAchievements?.achievements
    ? JSON.parse(cachedAchievements.achievements)
    : await getGameAchievementData(objectId, shop);

  const unlockedAchievements = await HydraApi.get<RemoteUnlockedAchievement[]>(
    `/users/${userId}/games/achievements`,
    { shop, objectId, language: userPreferences?.language || "en" }
  );

  return achievementsData
    .map((achievementData) => {
      const unlockedAchiementData = unlockedAchievements.find(
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

      if (unlockedAchiementData) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchiementData.unlockTime,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icon: icongray,
      } as UserAchievement;
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

export const getGameAchievements = async (
  objectId: string,
  shop: GameShop,
  userId?: string
): Promise<UserAchievement[]> => {
  if (!userId) {
    return getAchievementLocalUser(shop, objectId);
  }

  return getAchievementsRemoteUser(shop, objectId, userId);
};

const getGameAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  userId?: string
): Promise<UserAchievement[]> => {
  return getGameAchievements(objectId, shop, userId);
};

registerEvent("getGameAchievements", getGameAchievementsEvent);
