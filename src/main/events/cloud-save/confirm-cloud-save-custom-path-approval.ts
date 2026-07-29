import { launchGame } from "@main/helpers/launch-game";
import {
  assertCloudSaveSubscription,
  confirmPendingCloudSaveCustomPathApproval,
  getPendingCloudSaveCustomPathApproval,
} from "@main/services/cloud-save";
import type { ConfirmCloudSaveCustomPathApprovalResult } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "confirmCloudSaveCustomPathApproval",
  async (
    _event: Electron.IpcMainInvokeEvent,
    approvalId: string
  ): Promise<ConfirmCloudSaveCustomPathApprovalResult> => {
    assertCloudSaveSubscription();
    const launchOptions =
      await confirmPendingCloudSaveCustomPathApproval(approvalId);

    await launchGame(launchOptions);

    return {
      pendingApproval: getPendingCloudSaveCustomPathApproval(
        launchOptions.shop,
        launchOptions.objectId
      ),
    };
  }
);
