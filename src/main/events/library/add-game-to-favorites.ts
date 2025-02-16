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

  try {
    await gamesSublevel.put(gameKey, {
      ...game,
      favorite: true,
    });
  } catch (error) {
    throw new Error(`Failed to update game favorite status: ${error}`);
  }
};

registerEvent("addGameToFavorites", addGameToFavorites);
