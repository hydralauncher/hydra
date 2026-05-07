import { registerEvent } from "../register-event";

import { DownloadManager, logger, WindowManager } from "@main/services";
import { downloadsSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import { getDownloadPlacement } from "../../../types";

function isSameDownload(
  left: { shop: GameShop; objectId: string },
  right: { shop: GameShop; objectId: string }
) {
  return left.shop === right.shop && left.objectId === right.objectId;
}

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
    logger.log(
      `[Downloads] Resume requested for ${gameKey} (status=${download.status}, queued=${download.queued})`
    );

    const allDownloads = await downloadsSublevel.values().all();
    const currentHeroDownload =
      allDownloads.find(
        (entry) =>
          !isSameDownload(entry, download) &&
          getDownloadPlacement(entry) === "hero"
      ) ?? null;

    await DownloadManager.pauseDownload();

    for await (const [key, value] of downloadsSublevel.iterator()) {
      if (value.status === "active" && value.progress !== 1) {
        await downloadsSublevel.put(key, {
          ...value,
          status: "paused",
          pinnedToHero: false,
        });
      }
    }

    if (currentHeroDownload?.status === "paused") {
      await downloadsSublevel.put(
        levelKeys.game(currentHeroDownload.shop, currentHeroDownload.objectId),
        {
          ...currentHeroDownload,
          pinnedToHero: false,
          queued: false,
        }
      );
    }

    await DownloadManager.resumeDownload(download);

    await downloadsSublevel.put(gameKey, {
      ...download,
      status: "active",
      timestamp: Date.now(),
      queued: true,
      pinnedToHero: false,
      extracting: false,
    });
    WindowManager.sendDownloadsUpdated();
  }
};

registerEvent("resumeGameDownload", resumeGameDownload);
