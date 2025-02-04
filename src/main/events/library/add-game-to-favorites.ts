import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const addGameToFavorites = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    favorite: true,
  });
};

registerEvent("addGameToFavorites", addGameToFavorites);
