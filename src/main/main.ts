import { downloadsSublevel } from "./level/sublevels/downloads";
import { orderBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import { type Download, type UserPreferences } from "../types";
import path from "node:path";
import fs from "node:fs";
import {
  SystemPath,
  CommonRedistManager,
  TorBoxClient,
  RealDebridClient,
  PremiumizeClient,
  AllDebridClient,
  DownloadManager,
  HydraApi,
  uploadGamesBatch,
  startMainLoop,
  Ludusavi,
  Lock,
  DeckyPlugin,
  DownloadSourcesChecker,
  DownloadOrchestrator,
  WSClient,
  Wine,
  WindowManager,
  logger,
} from "@main/services";
import { migrateDownloadSources } from "./helpers/migrate-download-sources";
import { isDocPortalPath, isFlatpak } from "./helpers/sandbox";
import { getDirSize } from "./services/download/helpers";
import { GofileApi } from "./services/hosters";
import { PathGrants } from "./services/path-grants";

// Under Flatpak, a download path granted through the document portal can
// become unreachable when the grant is revoked. This is distinct from
// missing files: the data is still on disk, the sandbox just lost access.
const hasLostPathGrant = async (download: Download): Promise<boolean> => {
  if (!isFlatpak || !isDocPortalPath(download.downloadPath)) return false;

  return !(await PathGrants.verifyAccess(download.downloadPath));
};

const hasMissingSeedFiles = async (download: Download): Promise<boolean> => {
  if (!download.folderName) return false;

  const downloadTargetPath = path.join(
    download.downloadPath,
    download.folderName
  );

  if (!fs.existsSync(downloadTargetPath)) {
    return true;
  }

  const expectedSize = download.selectedFilesSize ?? download.fileSize ?? 0;

  if (expectedSize <= 0) {
    return false;
  }

  const currentSize = await getDirSize(downloadTargetPath);
  return currentSize < expectedSize;
};

export const loadState = async () => {
  await Lock.acquireLock();

  if (isFlatpak) {
    // The statically-granted default downloads folder (xdg-download/Hydra)
    // does not exist on first run; writability checks expect it to.
    const { defaultDownloadsPath } = await import("./constants");
    fs.mkdirSync(defaultDownloadsPath, { recursive: true });
  }

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  Wine.syncUserPreferences(userPreferences);

  await import("./events");

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences.realDebridApiToken);
  }

  if (userPreferences?.premiumizeApiToken) {
    PremiumizeClient.authorize(userPreferences.premiumizeApiToken);
  }

  if (userPreferences?.allDebridApiToken) {
    AllDebridClient.authorize(userPreferences.allDebridApiToken);
  }

  if (userPreferences?.torBoxApiToken) {
    TorBoxClient.authorize(userPreferences.torBoxApiToken);
  }

  GofileApi.initialize();

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

  const downloadToResume =
    await DownloadOrchestrator.bootstrapDownloadsOnStartup();
  const normalizedDownloads = await downloadsSublevel
    .values()
    .all()
    .then((games) => orderBy(games, "timestamp", "desc"));

  const downloadsToSeed: Download[] = [];

  const lostGrantPaths: string[] = [];

  for (const game of normalizedDownloads) {
    if (
      !game.shouldSeed ||
      game.downloader !== Downloader.Torrent ||
      game.progress !== 1 ||
      game.status !== "seeding" ||
      game.uri === null
    ) {
      continue;
    }

    if (await hasLostPathGrant(game)) {
      const gameKey = levelKeys.game(game.shop, game.objectId);

      // Keep progress and shouldSeed intact: the files still exist on the
      // host, seeding can resume once the user grants access again.
      await downloadsSublevel.put(gameKey, {
        ...game,
        status: "paused",
        queued: false,
      });

      lostGrantPaths.push(game.downloadPath);

      logger.warn(
        `[Startup] Lost portal grant for ${gameKey} at ${game.downloadPath}; download was paused`
      );
      continue;
    }

    if (!(await hasMissingSeedFiles(game))) {
      downloadsToSeed.push(game);
      continue;
    }

    const gameKey = levelKeys.game(game.shop, game.objectId);
    const expectedSize = game.selectedFilesSize ?? game.fileSize ?? 0;
    let progress = game.progress;

    if (game.folderName) {
      const downloadTargetPath = path.join(game.downloadPath, game.folderName);
      const currentSize = fs.existsSync(downloadTargetPath)
        ? await getDirSize(downloadTargetPath)
        : 0;
      progress =
        expectedSize > 0
          ? Math.min(currentSize / expectedSize, 1)
          : game.progress;
    }

    await downloadsSublevel.put(gameKey, {
      ...game,
      status: "paused",
      shouldSeed: false,
      queued: false,
      pinnedToHero: false,
      progress,
    });

    logger.warn(
      `[Startup] Seed files missing for ${gameKey}; seeding was disabled`
    );
  }

  // For torrents use Python RPC; HTTP downloads use JS downloader.
  const isTorrent = downloadToResume?.downloader === Downloader.Torrent;
  if (downloadToResume && !isTorrent) {
    // Start Python RPC for seeding only, then resume HTTP download with JS
    await DownloadManager.startRPC(undefined, downloadsToSeed);
    await DownloadManager.startDownload(downloadToResume).catch((err) => {
      // If resume fails, just log it - user can manually retry
      logger.error("Failed to auto-resume download:", err);
    });
  } else {
    // Use Python RPC for everything (torrent or fallback)
    await DownloadManager.startRPC(
      downloadToResume ?? undefined,
      downloadsToSeed
    );
  }

  WindowManager.sendDownloadsUpdated();

  if (lostGrantPaths.length > 0) {
    const displayPaths = await Promise.all(
      lostGrantPaths.map((grantPath) => PathGrants.getDisplayPath(grantPath))
    );
    WindowManager.sendToAppWindows("on-path-grants-lost", displayPaths);
  }

  startMainLoop();

  CommonRedistManager.downloadCommonRedist();

  SystemPath.checkIfPathsAreAvailable();
};
