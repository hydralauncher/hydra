import { getCloudSaveV2FileDetails } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getCloudSaveV2FileDetails",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    getCloudSaveV2FileDetails(objectId, shop)
);
