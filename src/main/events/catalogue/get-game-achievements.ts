import type { GameAchievement, GameShop } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import {
  gameAchievementRepository,
  gameRepository,
  userPreferencesRepository,
} from "@main/repository";
import { UserNotLoggedInError } from "@shared";

const getGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<GameAchievement[]> => {
  const [game, cachedAchievements, userPreferences] = await Promise.all([
    gameRepository.findOne({
      where: { objectID: objectId, shop },
    }),
    gameAchievementRepository.findOne({ where: { objectId, shop } }),
    userPreferencesRepository.findOne({
      where: { id: 1 },
    }),
  ]);

  const apiAchievement = HydraApi.get("/games/achievements", {
    objectId,
    shop,
    language: userPreferences?.language || "en",
  })
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
    .catch((err) => {
      if (err instanceof UserNotLoggedInError) throw err;
      return [];
    });

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
          unlockTime: unlockedAchiement.unlockTime,
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
