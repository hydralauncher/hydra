import { registerEvent } from "../register-event";
import { levelKeys, gamesSublevel } from "@main/level";
import { Wine } from "@main/services";
import type { GameShop } from "@types";

const selectGameWinePrefix = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  winePrefixPath: string | null
) => {
  if (winePrefixPath && !Wine.validatePrefix(winePrefixPath)) {
    throw new Error("Invalid wine prefix path");
  }

  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    winePrefixPath: winePrefixPath,
  });
};

registerEvent("selectGameWinePrefix", selectGameWinePrefix);
