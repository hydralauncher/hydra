import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi, logger } from "@main/services";
import { createGame } from "@main/services/library-sync";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { Downloader, parseBytes } from "@shared";
import {
  handleDownloadError,
  isKnownDownloadError,
  prepareGameEntry,
} from "@main/helpers";

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
    fileSize,
    fileIndices,
    selectedFilesSize,
  } = payload;

  const parsedFileSize = parseBytes(fileSize ?? null);

  const gameKey = levelKeys.game(shop, objectId);

  logger.log(
    `[startGameDownload] Requested gameId=${gameKey} downloader=${Downloader[downloader]} selectiveFiles=${fileIndices?.length ?? 0}`
  );

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
    shouldSeed: false,
    timestamp: Date.now(),
    queued: true,
    extracting: false,
    automaticallyExtract,
    extractionProgress: 0,
    fileIndices,
    selectedFilesSize,
    fileSize: selectedFilesSize ?? parsedFileSize,
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

    logger.log(`[startGameDownload] Started gameId=${gameKey} successfully`);

    return { ok: true };
  } catch (err: unknown) {
    if (isKnownDownloadError(err)) {
      logger.warn(
        `Failed to start download with expected download error gameId=${gameKey}`,
        err
      );
    } else {
      logger.error(`Failed to start download gameId=${gameKey}`, err);
    }
    return handleDownloadError(err, downloader);
  }
};

registerEvent("startGameDownload", startGameDownload);
