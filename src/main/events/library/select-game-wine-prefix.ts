import { registerEvent } from "../register-event";
import { levelKeys, gamesSublevel } from "@main/level";
import type { GameShop } from "@types";

const selectGameWinePrefix = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  winePrefixPath: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    winePrefixPath: winePrefixPath,
  });
};

registerEvent("selectGameWinePrefix", selectGameWinePrefix);
