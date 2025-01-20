import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { GameShop } from "@types";
import { downloadsSublevel, levelKeys } from "@main/level";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  await DownloadManager.cancelDownload(shop, objectId);

  await downloadsSublevel.del(levelKeys.game(shop, objectId));
};

registerEvent("cancelGameDownload", cancelGameDownload);
