import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi, logger } from "@main/services";
import { createGame } from "@main/services/library-sync";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { parseBytes } from "@shared";
import { handleDownloadError, prepareGameEntry } from "@main/helpers";

const addGameToQueue = async (
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
    fileSize,
  } = payload;

  const gameKey = levelKeys.game(shop, objectId);

  const download: Download = {
    shop,
    objectId,
    status: "paused",
    progress: 0,
    bytesDownloaded: 0,
    downloadPath,
    downloader,
    uri,
    folderName: null,
    fileSize: parseBytes(fileSize ?? null),
    shouldSeed: false,
    timestamp: Date.now(),
    queued: true,
    extracting: false,
    automaticallyExtract,
    extractionProgress: 0,
  };

  try {
    await DownloadManager.validateDownloadUrl(download);
  } catch (err: unknown) {
    logger.error("Failed to validate download URL for queue", err);
    return handleDownloadError(err, downloader);
  }

  await prepareGameEntry({ gameKey, title, objectId, shop });

  try {
    await downloadsSublevel.put(gameKey, download);

    const updatedGame = await gamesSublevel.get(gameKey);

    const promises: Promise<unknown>[] = [
      HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
        needsAuth: false,
      }).catch(() => {}),
    ];

    if (updatedGame) {
      promises.push(createGame(updatedGame).catch(() => {}));
    }

    await Promise.all(promises);

    return { ok: true };
  } catch (err: unknown) {
    logger.error("Failed to add game to queue", err);

    if (err instanceof Error) {
      return { ok: false, error: err.message };
    }

    return { ok: false };
  }
};

registerEvent("addGameToQueue", addGameToQueue);
