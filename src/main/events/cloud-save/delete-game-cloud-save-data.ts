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
    const assertGameNotRunning = () => {
      if (isGameRunning(objectId, shop)) {
        throw new Error("cloud_save_delete_game_running");
      }
    };

    assertGameNotRunning();
    await deleteGameCloudSaveData(objectId, shop, assertGameNotRunning);
  }
);
