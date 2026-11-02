import { levelKeys } from "@main/level";
import { updateGameRecord } from "@main/services/game-record-updater";
import { enableHydraPlaytimeForRunningSession } from "@main/services/game-running-state";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

const setGameHydraPlaytimeEnabled = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  enabled: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  await updateGameRecord(gameKey, {
    enableHydraPlaytimeTracking: enabled,
  });

  if (enabled) {
    enableHydraPlaytimeForRunningSession(gameKey);
  }
};

registerEvent("setGameHydraPlaytimeEnabled", setGameHydraPlaytimeEnabled);
