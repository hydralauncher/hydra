import { registerEvent } from "../register-event";
import { setLegacyCloudSaveAutomaticSyncEnabled } from "@main/services/cloud-save";
import type { GameShop } from "@types";

const toggleAutomaticCloudSync = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  automaticCloudSync: boolean
) => {
  return setLegacyCloudSaveAutomaticSyncEnabled(
    objectId,
    shop,
    automaticCloudSync
  );
};

registerEvent("toggleAutomaticCloudSync", toggleAutomaticCloudSync);
