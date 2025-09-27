import { registerEvent } from "../register-event";
import { collectionsSublevel, levelKeys } from "@main/level";
import type { Collection } from "@types";
import { v4 as uuidv4 } from "uuid";

const createCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  name: string
): Promise<Collection> => {
  const id = uuidv4();
  const now = new Date();

  const collection: Collection = {
    id,
    name,
    gameIds: [],
    createdAt: now,
    updatedAt: now,
  };

  const collectionKey = levelKeys.collection(id);
  await collectionsSublevel.put(collectionKey, collection);

  return collection;
};

registerEvent("createCollection", createCollection);
