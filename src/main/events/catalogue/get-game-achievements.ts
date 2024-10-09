import type {
  AchievementData,
  GameAchievement,
  GameShop,
  UnlockedAchievement,
} from "@types";
import { registerEvent } from "../register-event";
import {
  gameAchievementRepository,
  userAuthRepository,
} from "@main/repository";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { HydraApi } from "@main/services";

const getAchievements = async (
  shop: string,
  objectId: string,
  userId?: string
) => {
  const userAuth = await userAuthRepository.findOne({ where: { userId } });

  const cachedAchievements = await gameAchievementRepository.findOne({
    where: { objectId, shop },
  });

  const achievementsData: AchievementData[] = cachedAchievements?.achievements
    ? JSON.parse(cachedAchievements.achievements)
    : await getGameAchievementData(objectId, shop);

  if (!userId || userAuth) {
    const unlockedAchievements = JSON.parse(
      cachedAchievements?.unlockedAchievements || "[]"
    ) as UnlockedAchievement[];

    return { achievementsData, unlockedAchievements };
  }

  const unlockedAchievements = await HydraApi.get<UnlockedAchievement[]>(
    `/users/${userId}/games/achievements`,
    { shop, objectId, language: "en" }
  );

  return { achievementsData, unlockedAchievements };
};

export const getGameAchievements = async (
  objectId: string,
  shop: GameShop,
  userId?: string
): Promise<GameAchievement[]> => {
  const { achievementsData, unlockedAchievements } = await getAchievements(
    shop,
    objectId,
    userId
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
          icongray,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icongray,
      } as GameAchievement;
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

const getGameAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  userId?: string
): Promise<GameAchievement[]> => {
  return getGameAchievements(objectId, shop, userId);
};

registerEvent("getGameAchievements", getGameAchievementsEvent);
