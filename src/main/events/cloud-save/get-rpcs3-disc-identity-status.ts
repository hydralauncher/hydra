import { gamesSublevel, levelKeys } from "@main/level";
import { getRpcs3DiscIdentityStatus } from "@main/services/cloud-save/rpcs3-game-identity";
import { getCloudSaveEmulatorProvider } from "@shared";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getRpcs3DiscIdentityStatus",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    if (
      !game ||
      getCloudSaveEmulatorProvider(shop, game.platform) !== "rpcs3"
    ) {
      throw new Error("cloud_save_v2_not_available");
    }
    return getRpcs3DiscIdentityStatus(game);
  }
);
