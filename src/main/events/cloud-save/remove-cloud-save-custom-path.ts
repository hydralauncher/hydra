import {
  assertCloudSaveDeletionInactive,
  removeCloudSaveCustomPathAndSync,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { CloudSaveSyncIpcProgressPayload, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "removeCloudSaveCustomPath",
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
        "Cloud save custom paths cannot be removed while the game is running"
      );
    }
    assertCloudSaveDeletionInactive(objectId, shop);

    return removeCloudSaveCustomPathAndSync(
      objectId,
      shop,
      rawPath,
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
