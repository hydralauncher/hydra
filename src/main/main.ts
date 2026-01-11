import { downloadsSublevel } from "./level/sublevels/downloads";
import { orderBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import type { Download, UserPreferences } from "@types";
import {
  SystemPath,
  CommonRedistManager,
  TorBoxClient,
  RealDebridClient,
  Aria2,
  DownloadManager,
  HydraApi,
  uploadGamesBatch,
  startMainLoop,
  Ludusavi,
  Lock,
  DeckyPlugin,
  DownloadSourcesChecker,
  WSClient,
  logger,
} from "@main/services";
import { migrateDownloadSources } from "./helpers/migrate-download-sources";

export const loadState = async () => {
  await Lock.acquireLock();

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  await import("./events");

  Aria2.spawn();

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences.realDebridApiToken);
  }

  if (userPreferences?.torBoxApiToken) {
    TorBoxClient.authorize(userPreferences.torBoxApiToken);
  }

  Ludusavi.copyConfigFileToUserData();
  Ludusavi.copyBinaryToUserData();

  if (process.platform === "linux") {
    DeckyPlugin.checkAndUpdateIfOutdated();
  }

  await HydraApi.setupApi().then(async () => {
    uploadGamesBatch();
    void migrateDownloadSources();

    const { syncDownloadSourcesFromApi } = await import("./services/user");
    void syncDownloadSourcesFromApi();

    // Check for new download options on startup (if enabled)
    (async () => {
      await DownloadSourcesChecker.checkForChanges();
    })();
    WSClient.connect();
  });

  const downloads = await downloadsSublevel
    .values()
    .all()
    .then((games) => {
      return orderBy(games, "timestamp", "desc");
    });

  let interruptedDownload: Download | null = null;

  for (const download of downloads) {
    const downloadKey = levelKeys.game(download.shop, download.objectId);

    // Reset extracting state
    if (download.extracting) {
      await downloadsSublevel.put(downloadKey, {
        ...download,
        extracting: false,
      });
    }

    // Find interrupted active download (download that was running when app closed)
    // Mark it as paused but remember it for auto-resume
    if (download.status === "active" && !interruptedDownload) {
      interruptedDownload = download;
      await downloadsSublevel.put(downloadKey, {
        ...download,
        status: "paused",
      });
    } else if (download.status === "active") {
      // Mark other active downloads as paused
      await downloadsSublevel.put(downloadKey, {
        ...download,
        status: "paused",
      });
    }
  }

  // Re-fetch downloads after status updates
  const updatedDownloads = await downloadsSublevel
    .values()
    .all()
    .then((games) => orderBy(games, "timestamp", "desc"));

  // Prioritize interrupted download, then queued downloads
  const downloadToResume =
    interruptedDownload ?? updatedDownloads.find((game) => game.queued);

  const downloadsToSeed = updatedDownloads.filter(
    (game) =>
      game.shouldSeed &&
      game.downloader === Downloader.Torrent &&
      game.progress === 1 &&
      game.uri !== null
  );

  // For torrents or if JS downloader is disabled, use Python RPC
  const isTorrent = downloadToResume?.downloader === Downloader.Torrent;
  // Default to true - native HTTP downloader is enabled by default
  const useJsDownloader =
    (userPreferences?.useNativeHttpDownloader ?? true) && !isTorrent;

  if (useJsDownloader && downloadToResume) {
    // Start Python RPC for seeding only, then resume HTTP download with JS
    await DownloadManager.startRPC(undefined, downloadsToSeed);
    await DownloadManager.startDownload(downloadToResume).catch((err) => {
      // If resume fails, just log it - user can manually retry
      logger.error("Failed to auto-resume download:", err);
    });
  } else {
    // Use Python RPC for everything (torrent or fallback)
    await DownloadManager.startRPC(downloadToResume, downloadsToSeed);
  }

  startMainLoop();

  CommonRedistManager.downloadCommonRedist();

  SystemPath.checkIfPathsAreAvailable();
};
