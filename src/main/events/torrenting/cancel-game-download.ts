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

  const download = await downloadsSublevel.get(downloadKey);

  if (!download) return;

  await downloadsSublevel.put(downloadKey, {
    ...download,
    status: "removed",
  });
};

registerEvent("cancelGameDownload", cancelGameDownload);
