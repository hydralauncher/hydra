import { gamesSublevel, levelKeys } from "@main/level";
import {
  setCloudSaveAutomaticSyncEnabled,
  withAutomaticSaveProviderLock,
} from "@main/services/cloud-save";
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
    if (!enabled || shop !== "epic")
      return setCloudSaveAutomaticSyncEnabled(objectId, shop, enabled);
    // Epic and Hydra automatic save sync are mutually exclusive.
    return withAutomaticSaveProviderLock(objectId, async () => {
      const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
      if (game?.epicInstallation)
        await setEpicCloudSaveSettings(objectId, { automaticSync: false });
      return setCloudSaveAutomaticSyncEnabled(objectId, shop, enabled);
    });
  }
);
