import type { GameShop, UnlockedAchievement, UserAchievement } from "@types";
import { registerEvent } from "../register-event";
import { gameAchievementRepository } from "@main/repository";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  const cachedAchievements = await gameAchievementRepository.findOne({
    where: { objectId, shop },
  });

  const achievementsData = await getGameAchievementData(objectId, shop);

  const unlockedAchievements = JSON.parse(
    cachedAchievements?.unlockedAchievements || "[]"
  ) as UnlockedAchievement[];

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
        icongray: icongray,
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

const getGameAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  return getUnlockedAchievements(objectId, shop);
};

registerEvent("getUnlockedAchievements", getGameAchievementsEvent);
