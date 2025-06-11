import type { ComparedAchievements, GameShop, UserPreferences } from "@types";
import { registerEvent } from "../register-event";

import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";

const getComparedUnlockedAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  userId: string
) => {
  await AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  const showHiddenAchievementsDescription =
    userPreferences?.showHiddenAchievementsDescription || false;

  return HydraApi.get<ComparedAchievements>(
    `/users/${userId}/games/achievements/compare`,
    {
      shop,
      objectId,
      language: userPreferences?.language ?? "en",
    }
  ).then((achievements) => {
    const sortedAchievements = achievements.achievements
      .sort((a, b) => {
        if (a.targetStat.unlocked && !b.targetStat.unlocked) return -1;
        if (!a.targetStat.unlocked && b.targetStat.unlocked) return 1;
        if (a.targetStat.unlocked && b.targetStat.unlocked) {
          return b.targetStat.unlockTime! - a.targetStat.unlockTime!;
        }

        return Number(a.hidden) - Number(b.hidden);
      })
      .map((achievement) => {
        if (!achievement.hidden) return achievement;

        if (!achievement.ownerStat) {
          return {
            ...achievement,
            description: "",
          };
        }

        if (!showHiddenAchievementsDescription && achievement.hidden) {
          return {
            ...achievement,
            description: "",
          };
        }

        return achievement;
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
