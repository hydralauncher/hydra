import { getLocalSaveFileDetails } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getLocalSaveFileDetails",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    getLocalSaveFileDetails(objectId, shop)
);
