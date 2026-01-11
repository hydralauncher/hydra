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
    await DownloadManager.pauseDownload(gameKey);

    let gamesToDownloadCount = 2
    for await (const [key, value] of downloadsSublevel.iterator()) {
      if (value.status === "active" && value.progress !== 1) {
        await downloadsSublevel.put(key, {
          ...value,
          manualOrder: 1,
          status: "paused",
        });
      } else {
        await downloadsSublevel.put(key, {
          ...value,
          manualOrder: gamesToDownloadCount,
        });
      }
      gamesToDownloadCount++
    }
  }
};

registerEvent("pauseGameDownload", pauseGameDownload);
