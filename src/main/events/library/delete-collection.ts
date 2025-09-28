import { registerEvent } from "../register-event";
import { collectionsSublevel, levelKeys } from "@main/level";

const deleteCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: string
): Promise<void> => {
  const collectionKey = levelKeys.collection(collectionId);
  await collectionsSublevel.del(collectionKey);
};

registerEvent("deleteCollection", deleteCollection);
