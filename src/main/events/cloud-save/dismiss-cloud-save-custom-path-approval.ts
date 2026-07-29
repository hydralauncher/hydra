import {
  assertCloudSaveSubscription,
  dismissPendingCloudSaveCustomPathApproval,
} from "@main/services/cloud-save";

import { registerEvent } from "../register-event";

registerEvent(
  "dismissCloudSaveCustomPathApproval",
  (_event: Electron.IpcMainInvokeEvent, approvalId: string): void => {
    assertCloudSaveSubscription();
    dismissPendingCloudSaveCustomPathApproval(approvalId);
  }
);
