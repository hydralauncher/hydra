import { collectionRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { Collection } from "@main/entity";

const removeCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  collection: Collection
) => {
  return await collectionRepository.remove(collection);
};

registerEvent("removeCollection", removeCollection);
