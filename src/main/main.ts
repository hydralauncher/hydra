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
  SSEClient,
  Wine,
  WindowManager,
  logger,
} from "@main/services";
import { migrateDownloadSources } from "./helpers/migrate-download-sources";
import {
  isDocPortalMountAvailable,
  isDocPortalPath,
  isFlatpak,
} from "./helpers/sandbox";
import { getDirSize } from "./services/download/helpers";
import { GofileApi } from "./services/hosters";
import { PathGrants } from "./services/path-grants";

// Under Flatpak, a download path granted through the document portal can
// become unreachable when the grant is revoked. This is distinct from
// missing files: the data is still on disk, the sandbox just lost access.
const hasLostPathGrant = async (download: Download): Promise<boolean> => {
  if (!isFlatpak || !isDocPortalPath(download.downloadPath)) return false;

  // If the whole portal mount is gone (e.g. portal restarted after suspend),
  // every grant would look broken — treat that as a session problem, not as a
  // revoked grant, so we don't pause every download at once.
  if (!isDocPortalMountAvailable()) return false;

  return !(await PathGrants.verifyAccess(download.downloadPath));
};

// Surfaces every portal path that became unreachable: the download paths we
// just paused, plus any other annotated grant (wine prefix, proton, game
// executable) found broken by PathGrants.listBroken. Without this, a lost
// grant on those paths only shows up as an opaque failure when the user later
// tries to launch the game, instead of the same toast downloads get.
const notifyLostPathGrants = async (pausedDownloadPaths: string[]) => {
  const pausedDisplayPaths = await Promise.all(
    pausedDownloadPaths.map((grantPath) => PathGrants.getDisplayPath(grantPath))
  );

  const handledAccessPaths = new Set(pausedDownloadPaths);
  const otherBrokenDisplayPaths = (await PathGrants.listBroken())
    .filter((grant) => !handledAccessPaths.has(grant.accessPath))
    .map((grant) => grant.displayPath);

  const displayPaths = [
    ...new Set([...pausedDisplayPaths, ...otherBrokenDisplayPaths]),
  ];

  if (displayPaths.length > 0) {
    WindowManager.sendToAppWindows("on-path-grants-lost", displayPaths);
  }
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

    if (HydraApi.isLoggedIn()) {
      SSEClient.connect();
    }
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
    // A lost portal grant can affect any resumable download, not just
    // completed torrents that are seeding. Checking every download here means
    // an in-progress download is paused gracefully on startup instead of
    // hitting an opaque write failure the moment it resumes.
    if (await hasLostPathGrant(game)) {
      const gameKey = levelKeys.game(game.shop, game.objectId);

      // Keep progress and shouldSeed intact: the files still exist on the
      // host, the download (or seed) can resume once access is granted again.
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

    if (
      !game.shouldSeed ||
      game.downloader !== Downloader.Torrent ||
      game.progress !== 1 ||
      game.status !== "seeding" ||
      game.uri === null
    ) {
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

  // Don't auto-resume a download whose portal grant was lost; it was already
  // paused above and surfaced to the user, so resuming would just fail.
  const resumableDownload =
    downloadToResume && (await hasLostPathGrant(downloadToResume))
      ? null
      : downloadToResume;

  // For torrents use Python RPC; HTTP downloads use JS downloader.
  const isTorrent = resumableDownload?.downloader === Downloader.Torrent;
  if (resumableDownload && !isTorrent) {
    // Start Python RPC for seeding only, then resume HTTP download with JS
    await DownloadManager.startRPC(undefined, downloadsToSeed);
    await DownloadManager.startDownload(resumableDownload).catch((err) => {
      // If resume fails, just log it - user can manually retry
      logger.error("Failed to auto-resume download:", err);
    });
  } else {
    // Use Python RPC for everything (torrent or fallback)
    await DownloadManager.startRPC(
      resumableDownload ?? undefined,
      downloadsToSeed
    );
  }

  WindowManager.sendDownloadsUpdated();

  await notifyLostPathGrants(lostGrantPaths);

  startMainLoop();

  CommonRedistManager.downloadCommonRedist();

  SystemPath.checkIfPathsAreAvailable();
};
