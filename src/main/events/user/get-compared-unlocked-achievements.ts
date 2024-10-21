import type { ComparedAchievements, GameShop } from "@types";
import { registerEvent } from "../register-event";
import { userPreferencesRepository } from "@main/repository";
import { HydraApi } from "@main/services";

const getComparedUnlockedAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  userId: string
) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  return HydraApi.get<ComparedAchievements>(
    `/users/${userId}/games/achievements/compare`,
    {
      shop,
      objectId,
      language: userPreferences?.language || "en",
    }
  ).then((achievements) => {
    const sortedAchievements = achievements.achievements.sort((a, b) => {
      if (a.otherUserStat.unlocked && !b.otherUserStat.unlocked) return -1;
      if (!a.otherUserStat.unlocked && b.otherUserStat.unlocked) return 1;
      if (a.otherUserStat.unlocked && b.otherUserStat.unlocked) {
        return b.otherUserStat.unlockTime! - a.otherUserStat.unlockTime!;
      }

      return Number(a.hidden) - Number(b.hidden);
    });

    return {
      ...achievements,
      achievements: sortedAchievements,
    } as ComparedAchievements;
  });
};

registerEvent(
  "getComparedUnlockedAchievements",
  getComparedUnlockedAchievements
);
