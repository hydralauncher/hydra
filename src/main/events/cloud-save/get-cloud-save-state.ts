import { getCloudSaveState } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getCloudSaveState",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    getCloudSaveState(objectId, shop)
);
