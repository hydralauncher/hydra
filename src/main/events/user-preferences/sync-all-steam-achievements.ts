import { db, gamesSublevel, levelKeys } from "@main/level";
import { mergeAchievements } from "@main/services/achievements/merge-achievements";
import { SteamAchievementsApi } from "@main/services/steam-achievements-api";
import { SteamSyncCancellation } from "@main/services/steam-sync-cancellation";
import { WindowManager } from "@main/services/window-manager";
import type { UserPreferences } from "@types";
import { registerEvent } from "../register-event";

const syncAllSteamAchievements = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  SteamSyncCancellation.reset("achievements");

  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const { steamLinkedAccountId, steamApiKey } = userPreferences;

  if (!steamLinkedAccountId || !steamApiKey) {
    throw new Error("steam_not_configured");
  }

  const allGames = await gamesSublevel.values().all();
  const steamGames = allGames.filter((g) => g.shop === "steam" && !g.isDeleted);

  const total = steamGames.length;
  let synced = 0;
  let totalNew = 0;
  let cancelled = false;

  for (const game of steamGames) {
    if (SteamSyncCancellation.isRequested("achievements")) {
      cancelled = true;
      break;
    }

    WindowManager.mainWindow?.webContents.send(
      "on-steam-achievements-sync-progress",
      { current: synced, total, gameTitle: game.title }
    );

    try {
      const unlocked = await SteamAchievementsApi.getPlayerAchievements(
        steamLinkedAccountId,
        steamApiKey,
        game.objectId
      );
      const newCount = await mergeAchievements(game, unlocked, false);
      totalNew += newCount;
    } catch {
      // Skip games with no achievements or API errors
    }

    synced++;
  }

  SteamSyncCancellation.reset("achievements");

  WindowManager.mainWindow?.webContents.send(
    "on-steam-achievements-sync-progress",
    {
      current: cancelled ? synced : total,
      total,
      gameTitle: "",
      done: true,
      cancelled,
    }
  );

  WindowManager.mainWindow?.webContents.send("on-library-batch-complete");

  return { total, synced, totalNew, cancelled };
};

registerEvent("syncAllSteamAchievements", syncAllSteamAchievements);
