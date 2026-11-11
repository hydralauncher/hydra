import { getCloudSaveInsights } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getCloudSaveInsights",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    getCloudSaveInsights(objectId, shop)
);
