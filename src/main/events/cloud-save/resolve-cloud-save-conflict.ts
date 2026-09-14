import { resolveCloudSaveConflict } from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type {
  CloudSaveConflictResolution,
  CloudSaveSyncIpcProgressPayload,
  GameShop,
} from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "resolveCloudSaveConflict",
  async (
    event: Electron.IpcMainInvokeEvent,
    operationId: string,
    objectId: string,
    shop: GameShop,
    resolution: CloudSaveConflictResolution
  ) => {
    if (!operationId) {
      throw new Error("Cloud save sync operation ID is required");
    }
    if (resolution !== "keep-local" && resolution !== "keep-remote") {
      throw new Error("Invalid cloud save conflict resolution");
    }
    if (isGameRunning(objectId, shop)) {
      throw new Error(
        "Cloud save conflicts cannot be resolved while game is running"
      );
    }

    return resolveCloudSaveConflict(objectId, shop, resolution, (progress) => {
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
