import type { ComparedAchievements, GameShop, UserPreferences } from "@types";
import { registerEvent } from "../register-event";

import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { withComparedAchievementDefinitions } from "@main/services/achievements/compared-achievement-definitions";

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

  const [achievements, definitions] = await Promise.all([
    HydraApi.get<ComparedAchievements>(
      `/users/${userId}/games/achievements/compare`,
      {
        shop,
        objectId,
        language: userPreferences?.language ?? "en",
      }
    ),
    getGameAchievementData(objectId, shop, true).catch(() => []),
  ]);

  const sortedAchievements = achievements.achievements.sort((a, b) => {
    if (a.targetStat.unlocked && !b.targetStat.unlocked) return -1;
    if (!a.targetStat.unlocked && b.targetStat.unlocked) return 1;
    if (a.targetStat.unlocked && b.targetStat.unlocked) {
      return b.targetStat.unlockTime! - a.targetStat.unlockTime!;
    }

    return Number(a.hidden) - Number(b.hidden);
  });

  return withComparedAchievementDefinitions(
    { ...achievements, achievements: sortedAchievements },
    definitions
  );
};

registerEvent(
  "getComparedUnlockedAchievements",
  getComparedUnlockedAchievements
);
