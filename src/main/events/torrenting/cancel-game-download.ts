import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { GameShop } from "@types";
import { downloadsSublevel, levelKeys } from "@main/level";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);

  await DownloadManager.cancelDownload(downloadKey);

  await downloadsSublevel.del(downloadKey);
};

registerEvent("cancelGameDownload", cancelGameDownload);
