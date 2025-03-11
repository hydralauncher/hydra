import { registerEvent } from "../register-event";
import { levelKeys, gamesSublevel } from "@main/level";
import type { GameShop } from "@types";

const toggleAutomaticCloudSync = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  automaticCloudSync: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    automaticCloudSync,
  });
};

registerEvent("toggleAutomaticCloudSync", toggleAutomaticCloudSync);
