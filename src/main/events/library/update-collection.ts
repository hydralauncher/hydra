import { registerEvent } from "../register-event";
import { collectionsSublevel, levelKeys } from "@main/level";
import type { Collection } from "@types";

const updateCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: string,
  updates: Partial<Pick<Collection, "name" | "gameIds">>
): Promise<Collection> => {
  const collectionKey = levelKeys.collection(collectionId);
  const collection = await collectionsSublevel.get(collectionKey);

  if (!collection) {
    throw new Error("Collection not found");
  }

  const updatedCollection: Collection = {
    ...collection,
    ...updates,
    updatedAt: new Date(),
  };

  await collectionsSublevel.put(collectionKey, updatedCollection);

  return updatedCollection;
};

registerEvent("updateCollection", updateCollection);
