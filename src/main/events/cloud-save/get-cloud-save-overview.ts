import { getCloudSaveOverview } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getCloudSaveOverview",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    getCloudSaveOverview(objectId, shop)
);
