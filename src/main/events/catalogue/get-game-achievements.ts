import type { GameAchievement, GameShop } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { gameAchievementRepository, gameRepository } from "@main/repository";

const getGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<GameAchievement[]> => {
  const [game, cachedAchievements] = await Promise.all([
    gameRepository.findOne({
      where: { objectID: objectId, shop },
    }),
    gameAchievementRepository.findOne({ where: { objectId, shop } }),
  ]);

  const apiAchievement = HydraApi.get(
    "/games/achievements",
    { objectId, shop },
    { needsAuth: false }
  )
    .then((achievements) => {
      if (game) {
        gameAchievementRepository.upsert(
          {
            objectId,
            shop,
            achievements: JSON.stringify(achievements),
          },
          ["objectId", "shop"]
        );
      }

      return achievements;
    })
    .catch(() => []);

  const gameAchievements = cachedAchievements?.achievements
    ? JSON.parse(cachedAchievements.achievements)
    : await apiAchievement;

  const unlockedAchievements = JSON.parse(
    cachedAchievements?.unlockedAchievements || "[]"
  ) as { name: string; unlockTime: number }[];

  return gameAchievements
    .map((achievement) => {
      const unlockedAchiement = unlockedAchievements.find(
        (localAchievement) => {
          return localAchievement.name == achievement.name;
        }
      );

      if (unlockedAchiement) {
        return {
          ...achievement,
          unlocked: true,
          unlockTime: unlockedAchiement.unlockTime * 1000,
        };
      }

      return { ...achievement, unlocked: false, unlockTime: null };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      return b.unlockTime - a.unlockTime;
    });
};

registerEvent("getGameAchievements", getGameAchievements);
