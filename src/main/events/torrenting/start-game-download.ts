import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi } from "@main/services";

import { steamGamesWorker } from "@main/workers";
import { createGame } from "@main/services/library-sync";
import { steamUrlBuilder } from "@shared";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const { objectId, title, shop, downloadPath, downloader, uri } = payload;

  const gameKey = levelKeys.game(shop, objectId);

  await DownloadManager.pauseDownload();

  for await (const [key, value] of downloadsSublevel.iterator()) {
    if (value.status === "active" && value.progress !== 1) {
      await downloadsSublevel.put(key, {
        ...value,
        status: "paused",
      });
    }
  }

  const game = await gamesSublevel.get(gameKey);

  /* Delete any previous download */
  await downloadsSublevel.del(gameKey);

  if (game?.isDeleted) {
    await gamesSublevel.put(gameKey, {
      ...game,
      isDeleted: false,
    });
  } else {
    const steamGame = await steamGamesWorker.run(Number(objectId), {
      name: "getById",
    });

    const iconUrl = steamGame?.clientIcon
      ? steamUrlBuilder.icon(objectId, steamGame.clientIcon)
      : null;

    await gamesSublevel.put(gameKey, {
      title,
      iconUrl,
      objectId,
      shop,
      remoteId: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      isDeleted: false,
    });
  }

  await DownloadManager.cancelDownload(gameKey);

  const download: Download = {
    shop,
    objectId,
    status: "active",
    progress: 0,
    bytesDownloaded: 0,
    downloadPath,
    downloader,
    uri,
    folderName: null,
    fileSize: null,
    shouldSeed: false,
    timestamp: Date.now(),
  };

  await downloadsSublevel.put(gameKey, download);

  await DownloadManager.startDownload(download);

  const updatedGame = await gamesSublevel.get(gameKey);

  await Promise.all([
    createGame(updatedGame!).catch(() => {}),
    HydraApi.post(
      "/games/download",
      {
        objectId,
        shop,
      },
      { needsAuth: false }
    ).catch(() => {}),
  ]);
};

registerEvent("startGameDownload", startGameDownload);
