import { syncGameCloudSave } from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { CloudSaveSyncIpcProgressPayload, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "syncGameCloudSave",
  async (
    event: Electron.IpcMainInvokeEvent,
    operationId: string,
    objectId: string,
    shop: GameShop
  ) => {
    if (!operationId)
      throw new Error("Cloud save sync operation ID is required");
    if (isGameRunning(objectId, shop)) {
      throw new Error(
        "Cloud saves cannot be synchronized while game is running"
      );
    }

    return syncGameCloudSave(objectId, shop, "manual", (progress) => {
      if (!event.sender.isDestroyed()) {
        const payload: CloudSaveSyncIpcProgressPayload = {
          operationId,
          ...progress,
        };
        event.sender.send("on-cloud-save-sync-progress", payload);
      }
    });
  }
);
