import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { downloadsSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";

const resumeGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const download = await downloadsSublevel.get(gameKey);

  if (
    download &&
    (download.status === "paused" ||
      download.status === "active" ||
      download.status === "error") &&
    download.progress !== 1
  ) {
    await DownloadManager.pauseDownload();

    for await (const [key, value] of downloadsSublevel.iterator()) {
      if (value.status === "active" && value.progress !== 1) {
        await downloadsSublevel.put(key, {
          ...value,
          status: "paused",
        });
      }
    }

    await DownloadManager.resumeDownload(download);

    await downloadsSublevel.put(gameKey, {
      ...download,
      status: "active",
      timestamp: Date.now(),
      queued: true,
    });
  }
};

registerEvent("resumeGameDownload", resumeGameDownload);
