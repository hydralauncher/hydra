import { registerEvent } from "../register-event";
import { collectionsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const removeGameFromCollection = async (
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
  const gameIndex = collection.gameIds.indexOf(gameId);

  if (gameIndex > -1) {
    collection.gameIds.splice(gameIndex, 1);
    collection.updatedAt = new Date();
    await collectionsSublevel.put(collectionKey, collection);
  }
};

registerEvent("removeGameFromCollection", removeGameFromCollection);
