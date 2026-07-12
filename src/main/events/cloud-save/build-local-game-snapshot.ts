import { buildLocalGameSnapshot } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "buildLocalGameSnapshot",
  (_event: Electron.IpcMainInvokeEvent, objectId: string, shop: GameShop) =>
    buildLocalGameSnapshot(objectId, shop)
);
