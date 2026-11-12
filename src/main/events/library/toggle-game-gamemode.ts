import { updateGameRecord } from "@main/services/game-record-updater";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const toggleGameGamemode = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  autoRunGamemode: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await updateGameRecord(gameKey, {
    autoRunGamemode,
  });
};

registerEvent("toggleGameGamemode", toggleGameGamemode);
