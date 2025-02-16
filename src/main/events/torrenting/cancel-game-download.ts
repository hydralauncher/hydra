import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { GameShop } from "@types";
import { levelKeys } from "@main/level";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);

  await DownloadManager.cancelDownload(downloadKey);
};

registerEvent("cancelGameDownload", cancelGameDownload);
