import { levelKeys } from "@main/level";
import type { Game, SteamGameSyncPayload } from "@types";

import { updateGameRecord } from "../game-record-updater";
import { HydraApi } from "../hydra-api";
import {
  mergeImportedProfileGame,
  type ImportedProfileGame,
} from "../library-sync/merge-imported-profile-game";
import { steamSyncLogger } from "../logger";
import { WindowManager } from "../window-manager";
import { createSteamGameExitSyncScheduler } from "./steam-game-exit-sync-scheduler";
import { steamSyncOrchestrator } from "./steam-sync-orchestrator";
import { chunkSteamGameSyncPayload } from "./steam-sync-snapshot";

const GAME_ENDPOINT = "/profile/integrations/steam/games";

const publishGame = async (
  steamAppId: string,
  payload: SteamGameSyncPayload,
  signal: AbortSignal
) => {
  for (const chunk of chunkSteamGameSyncPayload(payload)) {
    await HydraApi.put(
      `${GAME_ENDPOINT}/${encodeURIComponent(steamAppId)}`,
      chunk,
      { signal }
    );
  }

  const remoteGame = await HydraApi.get<ImportedProfileGame>(
    `/profile/games/steam/${encodeURIComponent(steamAppId)}`,
    undefined,
    { signal }
  );
  if (signal.aborted) return;
  if (remoteGame.shop !== "steam" || remoteGame.objectId !== steamAppId) {
    return;
  }

  const gameKey = levelKeys.game("steam", steamAppId);
  if (signal.aborted) return;

  const updatedGame = await updateGameRecord(gameKey, (localGame) =>
    mergeImportedProfileGame(localGame, remoteGame)
  );
  if (!updatedGame || signal.aborted) return;

  WindowManager.sendToAppWindows("on-library-batch-complete");
};

const scheduler = createSteamGameExitSyncScheduler({
  waitForFullSync: () => steamSyncOrchestrator.waitForCurrentRun(),
  collect: (steamAppId, signal) =>
    steamSyncOrchestrator.collectGameSyncPayload(steamAppId, signal),
  publish: publishGame,
  scheduleTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
  log: (message, ...args) => steamSyncLogger.log(message, ...args),
  logError: (message, ...args) => steamSyncLogger.error(message, ...args),
});

export const scheduleSteamGameExitSync = (game: Game) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  scheduler.schedule(gameKey, game.objectId);
};

export const cancelSteamGameExitSync = (game: Game) => {
  scheduler.cancel(levelKeys.game(game.shop, game.objectId));
};

export { shouldScheduleSteamGameExitSync } from "./steam-game-exit-sync-scheduler";
