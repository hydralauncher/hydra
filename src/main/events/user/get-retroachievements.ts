import { registerEvent } from "../register-event";
import type { GameShop, UserAchievement, UserPreferences } from "@types";
import { mergeRetroachievements } from "@main/services/achievements/merge-retroachievements";
import { achievementsLogger } from "@main/services/logger";
import { gamesSublevel, levelKeys } from "@main/level";
import { resolveRetroachievementsGameId } from "@main/services/achievements/retroachievements-fetcher";
import { db } from "@main/level";

const getRetroachievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  retroachievementsGameId?: number
): Promise<UserAchievement[]> => {
  try {
    if (!objectId) {
      throw new Error("Missing required parameter: objectId");
    }

    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );
    const resolvedGameId =
      retroachievementsGameId ??
      (game
        ? await resolveRetroachievementsGameId(game.title, game.platform)
        : null);
    const retroachievementsApiKey =
      userPreferences?.retroachievementsApiKey ?? "";
    const retroachievementsUsername =
      userPreferences?.retroachievementsUsername ?? "";

    if (!resolvedGameId || !retroachievementsApiKey) {
      throw new Error(
        `Could not resolve RetroAchievements game id from ${objectId}`
      );
    }

    achievementsLogger.log(
      `Fetching retroachievements for game ${objectId} (retroachievements ID: ${resolvedGameId})`
    );

    void shop;
    return mergeRetroachievements(
      resolvedGameId,
      retroachievementsApiKey,
      retroachievementsUsername || undefined
    );
  } catch (error) {
    achievementsLogger.error(
      `Failed to get retroachievements for ${objectId}:`,
      error
    );
    throw error;
  }
};

registerEvent("getRetroachievements", getRetroachievements);
