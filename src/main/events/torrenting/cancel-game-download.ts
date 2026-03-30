import { registerEvent } from "../register-event";

import { DownloadManager, logger } from "@main/services";
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

  logger.log(
    `[Downloads] Cancel requested for ${downloadKey} (status=${download.status}, queued=${download.queued})`
  );

  await downloadsSublevel.put(downloadKey, {
    ...download,
    status: "removed",
    queued: false,
    shouldSeed: false,
  });
};

registerEvent("cancelGameDownload", cancelGameDownload);
