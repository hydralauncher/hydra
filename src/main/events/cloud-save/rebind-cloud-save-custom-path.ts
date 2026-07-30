import {
  assertCloudSaveSubscription,
  assertCloudSaveDeletionInactive,
  confirmPendingCustomPathRebindApproval,
  createPendingCustomPathRebindApproval,
  getCloudSaveGameContext,
  isCloudSaveSyncActive,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type {
  CloudSaveCustomPathApproval,
  ConfirmCloudSaveCustomPathRebindApprovalResult,
  GameShop,
} from "@types";

import { registerEvent } from "../register-event";

const assertCustomPathCanChange = (objectId: string, shop: GameShop) => {
  assertCloudSaveDeletionInactive(objectId, shop);
  if (isGameRunning(objectId, shop)) {
    throw new Error("cloud_save_custom_path_game_running");
  }
  if (isCloudSaveSyncActive(objectId, shop)) {
    throw new Error("cloud_save_custom_path_sync_active");
  }
};

registerEvent(
  "createCloudSaveCustomPathRebindApproval",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    rawPath: string
  ): Promise<CloudSaveCustomPathApproval> => {
    assertCloudSaveSubscription();
    assertCustomPathCanChange(objectId, shop);
    const context = await getCloudSaveGameContext(objectId, shop);
    assertCustomPathCanChange(objectId, shop);
    return createPendingCustomPathRebindApproval(
      { objectId, shop },
      rawPath,
      context
    );
  }
);

registerEvent(
  "confirmCloudSaveCustomPathRebindApproval",
  async (
    _event: Electron.IpcMainInvokeEvent,
    approvalId: string,
    objectId: string,
    shop: GameShop
  ): Promise<ConfirmCloudSaveCustomPathRebindApprovalResult> => {
    assertCloudSaveSubscription();
    assertCustomPathCanChange(objectId, shop);
    return confirmPendingCustomPathRebindApproval(
      approvalId,
      { objectId, shop },
      () => assertCustomPathCanChange(objectId, shop)
    );
  }
);
