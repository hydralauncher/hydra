import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi, logger } from "@main/services";

import { steamGamesWorker } from "@main/workers";
import { createGame } from "@main/services/library-sync";
import { Downloader, DownloadError, steamUrlBuilder } from "@shared";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { AxiosError } from "axios";

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
    queued: true,
  };

  try {
    await DownloadManager.startDownload(download).then(() => {
      return downloadsSublevel.put(gameKey, download);
    });

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

    return { ok: true };
  } catch (err: unknown) {
    logger.error("Failed to start download", err);

    if (err instanceof AxiosError) {
      if (err.response?.status === 429 && downloader === Downloader.Gofile) {
        return { ok: false, error: DownloadError.GofileQuotaExceeded };
      }

      if (
        err.response?.status === 403 &&
        downloader === Downloader.RealDebrid
      ) {
        return {
          ok: false,
          error: DownloadError.RealDebridAccountNotAuthorized,
        };
      }

      if (downloader === Downloader.TorBox) {
        return { ok: false, error: err.response?.data?.detail };
      }
    }

    if (err instanceof Error) {
      return { ok: false, error: err.message };
    }

    return { ok: false };
  }
};

registerEvent("startGameDownload", startGameDownload);
