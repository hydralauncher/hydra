import type { GameShop, UserAchievement } from "@types";
import { syncAndGetUnlockedAchievements } from "./get-unlocked-achievements";
import { registerEvent } from "../register-event";
import { syncRetroAchievements } from "@main/services/retro-achievements/retro-achievements-sync";

const getRetroAchievementsAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  retroAchievementsGameId?: number
): Promise<UserAchievement[] | null> => {
  if (shop === "launchbox") {
    const { getRpcs3Achievements } = await import(
      "@main/services/achievements/rpcs3/rpcs3-achievements"
    );
    const local = await getRpcs3Achievements(objectId, shop);
    if (local !== null) return local;
  }
  const result = await syncRetroAchievements({
    objectId,
    shop,
    retroAchievementsGameId,
  });

  if (result.status === "no_mapping") {
    return syncAndGetUnlockedAchievements(objectId, shop);
  }

  return result.achievements;
};

registerEvent(
  "getRetroAchievementsAchievements",
  getRetroAchievementsAchievements
);
