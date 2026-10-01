import { bindRpcs3CloudSaveProfile } from "@main/services/cloud-save/bind-rpcs3-cloud-save-profile";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "bindRpcs3CloudSaveProfile",
  (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    cloudProfileId: string
  ) => bindRpcs3CloudSaveProfile(objectId, shop, cloudProfileId)
);
