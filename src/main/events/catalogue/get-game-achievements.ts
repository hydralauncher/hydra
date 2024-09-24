import type { GameShop } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { gameRepository } from "@main/repository";
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
  const gameAchievements = await HydraApi.get(
    "/games/achievements",
    { objectId, shop },
    { needsAuth: false }
  );

  const unlockedAchievements = JSON.parse(
    game?.achievements?.unlockedAchievements || "[]"
  ) as { name: string; unlockTime: number }[];

  return gameAchievements.map((achievement) => {
    const unlockedAchiement = unlockedAchievements.find((localAchievement) => {
      return localAchievement.name == achievement.name;
    });

    if (unlockedAchiement) {
      return {
        ...achievement,
        unlocked: true,
        unlockTime: unlockedAchiement.unlockTime * 1000,
      };
    }

    return { ...achievement, unlocked: false, unlockTime: null };
  });
};

registerEvent("getGameAchievements", getGameAchievements);
