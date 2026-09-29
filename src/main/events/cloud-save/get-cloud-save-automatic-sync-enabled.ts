import { getCloudSaveAutomaticSyncEnabled } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getCloudSaveAutomaticSyncEnabled",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    getCloudSaveAutomaticSyncEnabled(objectId, shop)
);
