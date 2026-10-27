import type { AchievementProgress, GameShop } from "@types";

import {
  ACHIEVEMENT_PROGRESS_MAX_AGE_MS,
  getStoredAchievementProgress,
} from "@main/services/achievements/achievement-progress";
import { registerEvent } from "../register-event";
import { syncAndGetUnlockedAchievements } from "./get-unlocked-achievements";

const ensureAchievementProgress = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<AchievementProgress | null> => {
  const stored = await getStoredAchievementProgress(shop, objectId);
  if (stored && Date.now() - stored.updatedAt < ACHIEVEMENT_PROGRESS_MAX_AGE_MS)
    return stored;

  await syncAndGetUnlockedAchievements(objectId, shop).catch(() => []);
  return (await getStoredAchievementProgress(shop, objectId)) ?? stored;
};

registerEvent("ensureAchievementProgress", ensureAchievementProgress);
