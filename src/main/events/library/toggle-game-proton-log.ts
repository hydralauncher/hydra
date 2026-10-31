import { updateGameRecord } from "@main/services/game-record-updater";
import { levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const toggleGameProtonLog = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  protonLogEnabled: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);

  await updateGameRecord(gameKey, {
    protonLogEnabled,
  });
};

registerEvent("toggleGameProtonLog", toggleGameProtonLog);
