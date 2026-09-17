import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { syncSteamGameOnGamePage } from "@main/services/steam-integration/steam-game-exit-sync";
import { shouldSyncSteamGameOnGamePage } from "@main/services/steam-integration/steam-game-page-sync-core";

import { registerEvent } from "../register-event";

const STEAM_APP_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

const syncSteamGameOnGamePageEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  steamAppId: string
): Promise<boolean> => {
  if (!STEAM_APP_ID_PATTERN.test(steamAppId)) return false;

  const game = await gamesSublevel.get(levelKeys.game("steam", steamAppId));
  if (!shouldSyncSteamGameOnGamePage(HydraApi.isLoggedIn(), game)) {
    return false;
  }

  return syncSteamGameOnGamePage(steamAppId);
};

registerEvent("syncSteamGameOnGamePage", syncSteamGameOnGamePageEvent);
