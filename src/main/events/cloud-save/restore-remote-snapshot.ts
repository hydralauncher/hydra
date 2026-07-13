import { restoreRemoteSnapshot } from "@main/services/cloud-save";
import type { CloudSaveGameId, RestoreFinishedPayload } from "@types";

import { registerEvent } from "../register-event";

const activeRestores = new Set<string>();

registerEvent(
  "restoreRemoteSnapshot",
  async (
    event: Electron.IpcMainInvokeEvent,
    snapshotId: string,
    gameId: CloudSaveGameId
  ) => {
    const operationKey = JSON.stringify([gameId.shop, gameId.objectId]);
    if (activeRestores.has(operationKey)) {
      throw new Error("A restore is already running for this game");
    }

    activeRestores.add(operationKey);
    try {
      const result = await restoreRemoteSnapshot(
        snapshotId,
        gameId,
        (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("on-cloud-save-restore-progress", progress);
          }
        }
      );
      const finished: RestoreFinishedPayload = {
        gameId,
        restoredFiles: result.restoredFiles,
        skippedFiles: result.skippedFiles,
        failedFiles: result.failedFiles,
      };
      if (!event.sender.isDestroyed()) {
        event.sender.send("on-cloud-save-restore-finished", finished);
      }
      return result;
    } finally {
      activeRestores.delete(operationKey);
    }
  }
);
