import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi, logger } from "@main/services";
import { createGame } from "@main/services/library-sync";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { handleDownloadError, prepareGameEntry } from "@main/helpers";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const {
    objectId,
    title,
    shop,
    downloadPath,
    downloader,
    uri,
    automaticallyExtract,
  } = payload;

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

  await prepareGameEntry({ gameKey, title, objectId, shop });

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
    extracting: false,
    automaticallyExtract,
    extractionProgress: 0,
  };

  try {
    await DownloadManager.startDownload(download).then(() => {
      return downloadsSublevel.put(gameKey, download);
    });

    const updatedGame = await gamesSublevel.get(gameKey);

    await Promise.all([
      createGame(updatedGame!).catch(() => {}),
      HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
        needsAuth: false,
      }).catch(() => {}),
    ]);

    return { ok: true };
  } catch (err: unknown) {
    logger.error("Failed to start download", err);
    return handleDownloadError(err, downloader);
  }
};

registerEvent("startGameDownload", startGameDownload);
