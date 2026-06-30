import type { GameShop, UserAchievement } from "@types";
import { registerEvent } from "../register-event";
import { syncRetroAchievements } from "@main/services/retro-achievements/retro-achievements-sync";

const getRetroAchievementsAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  retroAchievementsGameId: number
): Promise<UserAchievement[] | null> => {
  return syncRetroAchievements({ objectId, shop, retroAchievementsGameId });
};

registerEvent(
  "getRetroAchievementsAchievements",
  getRetroAchievementsAchievements
);
