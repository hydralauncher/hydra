import { registerEvent } from "../register-event";
import { downloadsSublevel } from "@main/level";
import { GameShop } from "@types";
import { levelKeys } from "@main/level";

const removeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);
  await downloadsSublevel.del(downloadKey);
};

registerEvent("removeGame", removeGame);
