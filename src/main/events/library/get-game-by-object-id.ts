import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

const getGameByObjectId = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string
) =>
  gameRepository.findOne({
    where: {
      objectID: objectId,
      isDeleted: false,
    },
  });

registerEvent("getGameByObjectId", getGameByObjectId);
