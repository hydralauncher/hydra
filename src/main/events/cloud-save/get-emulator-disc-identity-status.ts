import { gamesSublevel, levelKeys } from "@main/level";
import { getEmulatorDiscIdentityStatus } from "@main/services/cloud-save/emulator-disc-identity";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getEmulatorDiscIdentityStatus",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    const status = game ? await getEmulatorDiscIdentityStatus(game) : null;
    if (!status) throw new Error("cloud_save_v2_not_available");
    return status;
  }
);
