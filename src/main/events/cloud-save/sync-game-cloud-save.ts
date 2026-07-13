import { syncGameCloudSave } from "@main/services/cloud-save";
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
