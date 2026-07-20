import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload, UserPreferences } from "@types";
import {
  DownloadManager,
  DownloadOrchestrator,
  HydraApi,
  logger,
} from "@main/services";
import { createGame } from "@main/services/library-sync";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
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
    automaticallyDeleteArchiveFiles,
    fileIndices,
    selectedFilesSize,
    trackers,
  } = payload;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const globalTrackers = [
    ...(userPreferences?.appendGlobalTrackers
      ? userPreferences?.globalTrackers ?? []
      : []),
    ...(userPreferences?.appendGlobalTrackersUrl
      ? userPreferences?.globalTrackersUrlCache ?? []
      : []),
  ];

  const mergedTrackers =
    globalTrackers.length > 0 || trackers?.length
      ? [...new Set([...globalTrackers, ...(trackers ?? [])])]
      : undefined;

  const gameKey = levelKeys.game(shop, objectId);

  logger.log(
    `[Downloads] Start requested for ${gameKey} (downloader=${downloader})`
  );

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
    shouldSeed: false,
    timestamp: Date.now(),
    queued: true,
    pinnedToHero: false,
    extracting: false,
    automaticallyExtract,
    automaticallyDeleteArchiveFiles,
    fileIndices,
    selectedFilesSize,
    fileSize: selectedFilesSize ?? null,
    ...(mergedTrackers?.length ? { customTrackers: mergedTrackers } : {}),
  };

  try {
    await DownloadManager.validateDownloadUrl(download);
    await prepareGameEntry({ gameKey, title, objectId, shop });
    await DownloadManager.cancelDownload(gameKey);
    await downloadsSublevel.put(gameKey, download);
    await DownloadOrchestrator.startPreparedDownload(download);

    const updatedGame = await gamesSublevel.get(gameKey);

    await Promise.all([
      createGame(updatedGame!).catch(() => {}),
      HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
        needsAuth: false,
      }).catch(() => {}),
    ]);

    return { ok: true };
  } catch (err: unknown) {
    await downloadsSublevel.del(gameKey).catch(() => null);
    await DownloadOrchestrator.syncAfterDownloadRemoved({ shop, objectId });

    if (isKnownDownloadError(err)) {
      logger.warn("Failed to start download with expected download error", err);
    } else {
      logger.error("Failed to start download", err);
    }
    return handleDownloadError(err, downloader);
  }
};

registerEvent("startGameDownload", startGameDownload);
