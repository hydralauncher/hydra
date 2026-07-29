import {
  assertCloudSaveSubscription,
  getPendingCloudSaveCustomPathApproval,
} from "@main/services/cloud-save";
import type { CloudSaveCustomPathApproval, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getPendingCloudSaveCustomPathApproval",
  (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ): CloudSaveCustomPathApproval | null => {
    assertCloudSaveSubscription();
    return getPendingCloudSaveCustomPathApproval(shop, objectId);
  }
);
