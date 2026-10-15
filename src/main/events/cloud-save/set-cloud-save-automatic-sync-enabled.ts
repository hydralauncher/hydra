import { gamesSublevel, levelKeys } from "@main/level";
import { setCloudSaveAutomaticSyncEnabled } from "@main/services/cloud-save";
import { setEpicCloudSaveSettings } from "@main/services/epic";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "setCloudSaveAutomaticSyncEnabled",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    enabled: boolean
  ) => {
    // Epic and Hydra automatic save sync are mutually exclusive.
    if (enabled && shop === "epic") {
      const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
      if (game?.epicInstallation)
        await setEpicCloudSaveSettings(objectId, { automaticSync: false });
    }
    return setCloudSaveAutomaticSyncEnabled(objectId, shop, enabled);
  }
);
