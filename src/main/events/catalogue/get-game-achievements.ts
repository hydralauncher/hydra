import type { GameAchievement, GameShop } from "@types";
import { registerEvent } from "../register-event";
import { gameAchievementRepository } from "@main/repository";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";

const getGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<GameAchievement[]> => {
  const cachedAchievements = await gameAchievementRepository.findOne({
    where: { objectId, shop },
  });

  const achievementsData = cachedAchievements?.achievements
    ? JSON.parse(cachedAchievements.achievements)
    : await getGameAchievementData(objectId, shop);

  const unlockedAchievements = JSON.parse(
    cachedAchievements?.unlockedAchievements || "[]"
  ) as { name: string; unlockTime: number }[];

  return achievementsData
    .map((achievementData) => {
      const unlockedAchiement = unlockedAchievements.find(
        (localAchievement) => {
          return (
            localAchievement.name.toUpperCase() ==
            achievementData.name.toUpperCase()
          );
        }
      );

      if (unlockedAchiement) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchiement.unlockTime,
        };
      }

      return { ...achievementData, unlocked: false, unlockTime: null };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      return b.unlockTime - a.unlockTime;
    });
};

registerEvent("getGameAchievements", getGameAchievements);
