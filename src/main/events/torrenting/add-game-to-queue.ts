import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import {
  DownloadManager,
  DownloadOrchestrator,
  HydraApi,
  logger,
} from "@main/services";
import { createGame } from "@main/services/library-sync";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { parseBytes } from "@shared";
import {
  getGlobalTrackers,
  handleDownloadError,
  isKnownDownloadError,
  prepareGameEntry,
} from "@main/helpers";

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
    automaticallyDeleteArchiveFiles,
    fileSize,
    fileIndices,
    selectedFilesSize,
  } = payload;

  const parsedFileSize = parseBytes(fileSize ?? null);
  const gameKey = levelKeys.game(shop, objectId);
  let download: Download;
  let didWriteDownload = false;

  try {
    const globalTrackers = await getGlobalTrackers();

    download = {
      shop,
      objectId,
      status: "paused",
      progress: 0,
      bytesDownloaded: 0,
      downloadPath,
      downloader,
      uri,
      folderName: null,
      fileSize: selectedFilesSize ?? parsedFileSize,
      shouldSeed: false,
      timestamp: Date.now(),
      queued: true,
      pinnedToHero: false,
      extracting: false,
      automaticallyExtract,
      automaticallyDeleteArchiveFiles,
      fileIndices,
      selectedFilesSize,
      customTrackers: globalTrackers,
    };

    await DownloadManager.validateDownloadUrl(download);
    await prepareGameEntry({ gameKey, title, objectId, shop });
    await DownloadManager.cancelDownload(gameKey).catch(() => null);
  } catch (err: unknown) {
    if (isKnownDownloadError(err)) {
      logger.warn(
        "Failed to validate download URL for queue with expected download error",
        err
      );
    } else {
      logger.error("Failed to validate download URL for queue", err);
    }
    return handleDownloadError(err, downloader);
  }

  try {
    await downloadsSublevel.put(gameKey, download);
    didWriteDownload = true;
    await DownloadOrchestrator.enqueuePreparedDownload(download);

    const updatedGame = await gamesSublevel.get(gameKey);

    await Promise.all([
      createGame(updatedGame!).catch(() => {}),
      HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
        needsAuth: false,
      }).catch(() => {}),
    ]);

    return { ok: true };
  } catch (err: unknown) {
    if (didWriteDownload) {
      await DownloadManager.cancelDownload(gameKey).catch(() => null);
      await downloadsSublevel.del(gameKey).catch(() => null);
      await DownloadOrchestrator.syncAfterDownloadRemoved({ shop, objectId });
    }

    logger.error("Failed to add game to queue", err);

    if (err instanceof Error) {
      return { ok: false, error: err.message };
    }

    return { ok: false };
  }
};

registerEvent("addGameToQueue", addGameToQueue);
