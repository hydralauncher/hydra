import type { GameShop } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { gameAchievementRepository, gameRepository } from "@main/repository";
import { GameAchievement } from "@main/entity";

const getGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<GameAchievement[]> => {
  const game = await gameRepository.findOne({
    where: { objectID: objectId, shop },
    relations: {
      achievements: true,
    },
  });

  const cachedAchievements = game?.achievements?.achievements;

  const apiAchievement = HydraApi.get(
    "/games/achievements",
    { objectId, shop },
    { needsAuth: false }
  )
    .then((achievements) => {
      if (game) {
        gameAchievementRepository.upsert(
          {
            game: { id: game.id },
            achievements: JSON.stringify(achievements),
          },
          ["game"]
        );
      }

      return achievements;
    })
    .catch(() => []);

  const gameAchievements = cachedAchievements
    ? JSON.parse(cachedAchievements)
    : await apiAchievement;

  const unlockedAchievements = JSON.parse(
    game?.achievements?.unlockedAchievements || "[]"
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
