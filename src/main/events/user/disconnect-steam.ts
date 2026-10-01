import { registerEvent } from "../register-event";
import { HydraApi, WindowManager } from "@main/services";
import { steamSyncLogger } from "@main/services/logger";
import {
  mergeWithRemoteGames,
  fetchRemoteProfileGames,
} from "@main/services/library-sync";
import {
  collectSteamOnlyObjectIds,
  getSteamImportedDataCleanupPlan,
  hasImportedSteamData,
} from "@main/services/steam-integration/steam-imported-games";
import { clearImportedSteamGames } from "@main/services/steam-integration/clear-imported-steam-games";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { gamesSublevel } from "@main/level";

const OAUTH_ENDPOINT = "/profile/oauth/steam";

const restoreLastTimePlayed = async (
  lastTimePlayedByGameKey: Map<string, Date | null>
) => {
  for (const [key, lastTimePlayed] of lastTimePlayedByGameKey) {
    const game = await gamesSublevel.get(key);

    if (game && !game.isDeleted) {
      await gamesSublevel.put(key, { ...game, lastTimePlayed });
    }
  }
};

const getErrorMessage = (error: unknown): string | null => {
  if (typeof error === "object" && error !== null) {
    const response = (error as { response?: { data?: { message?: unknown } } })
      .response;
    const responseMessage = response?.data?.message;

    if (typeof responseMessage === "string") {
      return responseMessage;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return null;
};

const disconnectSteam = async (
  _event: Electron.IpcMainInvokeEvent,
  deleteImportedData: boolean
) => {
  let steamOnlyObjectIds: string[] = [];

  if (deleteImportedData) {
    const remoteGames = await fetchRemoteProfileGames();
    steamOnlyObjectIds = collectSteamOnlyObjectIds(remoteGames);
    steamSyncLogger.log(
      "Disconnect collecting steam-only games",
      steamOnlyObjectIds.length
    );
  }

  const steamOnlyObjectIdSet = new Set(steamOnlyObjectIds);
  const lastTimePlayedByGameKey = new Map<string, Date | null>();

  try {
    await HydraApi.delete(
      `${OAUTH_ENDPOINT}?deleteImportedData=${deleteImportedData}`
    );
  } catch (error) {
    const message = getErrorMessage(error);
    steamSyncLogger.error("Failed to disconnect Steam", error);
    throw new Error(message ?? "steam-disconnect-failed");
  }

  for (const [key, game] of await gamesSublevel.iterator().all()) {
    if (!deleteImportedData && game.hasActiveSteamImport) {
      await gamesSublevel.put(key, { ...game, hasActiveSteamImport: false });
      continue;
    }

    if (
      deleteImportedData &&
      hasImportedSteamData(game, steamOnlyObjectIdSet)
    ) {
      const cleanupPlan = getSteamImportedDataCleanupPlan(game);
      lastTimePlayedByGameKey.set(key, cleanupPlan.lastTimePlayedFallback);
      AchievementMemoryStore.delete(game.shop, game.objectId);
      await gamesSublevel.put(key, {
        ...game,
        ...cleanupPlan.cleanup,
      });
    }
  }

  if (!deleteImportedData) {
    steamSyncLogger.log("Steam disconnected, imported snapshot preserved");
    return;
  }

  await clearImportedSteamGames(steamOnlyObjectIds);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  const didMerge = await mergeWithRemoteGames();

  if (!didMerge) {
    await restoreLastTimePlayed(lastTimePlayedByGameKey);
    steamSyncLogger.warn(
      "Steam disconnect remote merge failed; restored local last-played values"
    );
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  steamSyncLogger.log("Steam disconnected and imported games cleared");
};

registerEvent("disconnectSteam", disconnectSteam);
