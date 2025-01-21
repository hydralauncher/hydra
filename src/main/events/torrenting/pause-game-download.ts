import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { GameShop } from "@types";
import { downloadsSublevel, levelKeys } from "@main/level";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const download = await downloadsSublevel.get(gameKey);

  if (download) {
    await DownloadManager.pauseDownload();

    await downloadsSublevel.put(gameKey, {
      ...download,
      status: "paused",
    });
  }
};

registerEvent("pauseGameDownload", pauseGameDownload);
