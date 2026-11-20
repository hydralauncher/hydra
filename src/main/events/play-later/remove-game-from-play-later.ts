import { levelKeys, playLaterSublevel } from "@main/level";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const removeGameFromPlayLater = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  await playLaterSublevel.del(levelKeys.game(shop, objectId));
};

registerEvent("removeGameFromPlayLater", removeGameFromPlayLater);
