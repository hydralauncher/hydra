import { registerEvent } from "../register-event";
import { levelKeys, downloadsSublevel } from "@main/level";
import { GameShop } from "@types";
import { GameFilesManager } from "@main/services/game-files-manager";

const removeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  GameFilesManager.cancelPs4Extraction(shop, objectId);
  const downloadKey = levelKeys.game(shop, objectId);
  await downloadsSublevel.del(downloadKey);
};

registerEvent("removeGame", removeGame);
