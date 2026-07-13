import { runAutomaticCloudSaveSync } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "syncCloudSaveOnStateChange",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => runAutomaticCloudSaveSync(objectId, shop, "state-changed")
);
