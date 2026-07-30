import { assertCloudSaveExecutableExists } from "@main/services/cloud-save/assert-cloud-save-executable";
import {
  assertCloudSaveSubscription,
  confirmPendingManualCloudSaveCustomPathApproval,
  createPendingManualCloudSaveCustomPathApproval,
  dismissPendingCloudSaveCustomPathApproval,
  getCloudSaveGameContext,
  isCloudSaveSyncActive,
  runCloudSaveModalSyncFlow,
  syncGameCloudSave,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type {
  CloudSaveModalSyncResult,
  CloudSaveSyncIpcProgressPayload,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "syncGameCloudSaveFromModal",
  async (
    event: Electron.IpcMainInvokeEvent,
    operationId: string,
    objectId: string,
    shop: GameShop,
    approvalId: string | null
  ): Promise<CloudSaveModalSyncResult> => {
    const assertApprovalCanContinue = () => {
      if (isGameRunning(objectId, shop)) {
        throw new Error(
          "Cloud saves cannot be synchronized while game is running"
        );
      }
      if (isCloudSaveSyncActive(objectId, shop)) {
        throw new Error("cloud_save_custom_path_sync_active");
      }
    };

    if (!operationId) {
      throw new Error("Cloud save sync operation ID is required");
    }
    if (isGameRunning(objectId, shop)) {
      throw new Error(
        "Cloud saves cannot be synchronized while game is running"
      );
    }
    if (approvalId) assertApprovalCanContinue();

    assertCloudSaveSubscription();
    await assertCloudSaveExecutableExists(objectId, shop);

    const onProgress = (progress: CloudSaveSyncProgressPayload) => {
      if (!event.sender.isDestroyed()) {
        const payload: CloudSaveSyncIpcProgressPayload = {
          operationId,
          ...progress,
        };
        event.sender.send("on-cloud-save-sync-progress", payload);
      }
    };

    return runCloudSaveModalSyncFlow(approvalId, {
      confirmApproval: (id) =>
        confirmPendingManualCloudSaveCustomPathApproval(
          id,
          {
            objectId,
            shop,
          },
          assertApprovalCanContinue
        ),
      getContext: () => getCloudSaveGameContext(objectId, shop),
      createApproval: (context, preserveApprovalId) =>
        createPendingManualCloudSaveCustomPathApproval(
          { objectId, shop },
          context,
          preserveApprovalId ?? undefined
        ),
      completeApproval: async (id) => {
        dismissPendingCloudSaveCustomPathApproval(id);
      },
      sync: (trigger, context) =>
        syncGameCloudSave(objectId, shop, trigger, onProgress, context),
    });
  }
);
