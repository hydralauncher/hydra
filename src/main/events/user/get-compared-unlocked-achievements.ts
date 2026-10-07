import type { ComparedAchievements, GameShop, UserPreferences } from "@types";
import { registerEvent } from "../register-event";

import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { getMockUnlockPercentage } from "@main/services/achievements/mock-unlock-percentage";

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

  return HydraApi.get<ComparedAchievements>(
    `/users/${userId}/games/achievements/compare`,
    {
      shop,
      objectId,
      language: userPreferences?.language ?? "en",
    }
  ).then((achievements) => {
    const sortedAchievements = achievements.achievements.sort((a, b) => {
      if (a.targetStat.unlocked && !b.targetStat.unlocked) return -1;
      if (!a.targetStat.unlocked && b.targetStat.unlocked) return 1;
      if (a.targetStat.unlocked && b.targetStat.unlocked) {
        return b.targetStat.unlockTime! - a.targetStat.unlockTime!;
      }

      return Number(a.hidden) - Number(b.hidden);
    });

    return {
      ...achievements,
      achievements: sortedAchievements.map((achievement) => ({
        ...achievement,
        globalUnlockPercentage:
          achievement.globalUnlockPercentage ??
          getMockUnlockPercentage(achievement.points),
      })),
    } as ComparedAchievements;
  });
};

registerEvent(
  "getComparedUnlockedAchievements",
  getComparedUnlockedAchievements
);
