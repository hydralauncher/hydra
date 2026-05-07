import { registerEvent } from "../register-event";

import { DownloadManager, WindowManager } from "@main/services";
import { GameShop } from "@types";
import { downloadsSublevel, levelKeys } from "@main/level";
import { getDownloadPlacement } from "../../../types";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const download = await downloadsSublevel.get(gameKey);

  if (download) {
    await DownloadManager.pauseDownload(gameKey);
    WindowManager.sendToAppWindows("on-download-progress", null);
    const wasHero = getDownloadPlacement(download) === "hero";

    await downloadsSublevel.put(gameKey, {
      ...download,
      status: "paused",
      queued: false,
      pinnedToHero: wasHero,
      extracting: false,
    });
    WindowManager.sendDownloadsUpdated();
  }
};

registerEvent("pauseGameDownload", pauseGameDownload);
