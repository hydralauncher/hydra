import { registerEvent } from "../register-event";
import { collectionsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const addGameToCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: string,
  shop: GameShop,
  objectId: string
): Promise<void> => {
  const collectionKey = levelKeys.collection(collectionId);
  const collection = await collectionsSublevel.get(collectionKey);

  if (!collection) {
    throw new Error("Collection not found");
  }

  const gameId = levelKeys.game(shop, objectId);

  if (!collection.gameIds.includes(gameId)) {
    collection.gameIds.push(gameId);
    collection.updatedAt = new Date();
    await collectionsSublevel.put(collectionKey, collection);
  }
};

registerEvent("addGameToCollection", addGameToCollection);
