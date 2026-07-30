import { deleteGameCloudSaveData } from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "deleteGameCloudSaveData",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => {
    if (isGameRunning(objectId, shop)) {
      throw new Error(
        "Cloud saves cannot be deleted while the game is running"
      );
    }

    await deleteGameCloudSaveData(objectId, shop);
  }
);
