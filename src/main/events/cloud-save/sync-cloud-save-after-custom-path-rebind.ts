import {
  isCloudSaveCustomPathRegistered,
  syncGameCloudSave,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { CloudSaveSyncIpcProgressPayload, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "syncCloudSaveAfterCustomPathRebind",
  async (
    event: Electron.IpcMainInvokeEvent,
    operationId: string,
    objectId: string,
    shop: GameShop,
    rawPath: string
  ) => {
    if (!operationId) {
      throw new Error("Cloud save sync operation ID is required");
    }
    if (isGameRunning(objectId, shop)) {
      throw new Error(
        "Cloud saves cannot be synchronized while game is running"
      );
    }
    if (!(await isCloudSaveCustomPathRegistered(shop, objectId, rawPath))) {
      throw new Error("cloud_save_custom_path_not_registered");
    }

    return syncGameCloudSave(
      objectId,
      shop,
      "custom-path-rebind",
      (progress) => {
        if (!event.sender.isDestroyed()) {
          const payload: CloudSaveSyncIpcProgressPayload = {
            operationId,
            ...progress,
          };
          event.sender.send("on-cloud-save-sync-progress", payload);
        }
      }
    );
  }
);
