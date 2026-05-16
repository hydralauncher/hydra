import { db, gamesSublevel, levelKeys } from "@main/level";
import { mergeAchievements } from "@main/services/achievements/merge-achievements";
import { SteamAchievementsApi } from "@main/services/steam-achievements-api";
import type { GameShop, UserPreferences } from "@types";
import { registerEvent } from "../register-event";

const importSteamAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const { steamLinkedAccountId, steamApiKey } = userPreferences;

  if (!steamLinkedAccountId || !steamApiKey) {
    throw new Error("steam_not_configured");
  }

  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  if (!game) {
    throw new Error("game_not_found");
  }

  const unlockedAchievements = await SteamAchievementsApi.getPlayerAchievements(
    steamLinkedAccountId,
    steamApiKey,
    objectId
  );

  const newCount = await mergeAchievements(game, unlockedAchievements, false);
  return { importedCount: unlockedAchievements.length, newCount };
};

registerEvent("importSteamAchievements", importSteamAchievements);
