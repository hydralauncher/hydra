import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi } from "@main/services";
import { gamesSublevel, levelKeys } from "@main/level";

const getGameBackupPreview = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  return Ludusavi.getBackupPreview(shop, objectId, game?.winePrefixPath);
};

registerEvent("getGameBackupPreview", getGameBackupPreview);
