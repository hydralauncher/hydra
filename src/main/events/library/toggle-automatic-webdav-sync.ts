import { registerEvent } from "../register-event";
import { levelKeys, gamesSublevel } from "@main/level";
import type { GameShop } from "@types";

const toggleAutomaticWebDavSync = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  automaticWebDavSync: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    automaticWebDavSync,
  });
};

registerEvent("toggleAutomaticWebDavSync", toggleAutomaticWebDavSync);
