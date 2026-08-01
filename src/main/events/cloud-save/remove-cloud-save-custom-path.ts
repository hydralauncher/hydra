import {
  assertCloudSaveDeletionInactive,
  untrackCloudSaveCustomPath,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "removeCloudSaveCustomPath",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    rawPath: string
  ) => {
    if (isGameRunning(objectId, shop)) {
      throw new Error(
        "Cloud save custom paths cannot be removed while the game is running"
      );
    }
    assertCloudSaveDeletionInactive(objectId, shop);

    return untrackCloudSaveCustomPath(objectId, shop, rawPath);
  }
);
