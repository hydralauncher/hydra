import { collectionRepository } from "@main/repository";

import { registerEvent } from "../register-event";

const addCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string
) => {
  return await collectionRepository.insert({
    title: title,
  });
};

registerEvent("addCollection", addCollection);
