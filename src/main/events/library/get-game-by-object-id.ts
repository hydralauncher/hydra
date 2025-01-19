import { registerEvent } from "../register-event";
import { levelKeys } from "@main/level";
import { gamesSublevel } from "@main/level";
import type { GameShop } from "@types";

const getGameByObjectId = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  return game;
};

registerEvent("getGameByObjectId", getGameByObjectId);
