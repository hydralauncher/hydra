import {
  Downloader,
  DownloadError,
  FILE_EXTENSIONS_TO_EXTRACT,
  resolveArchiveOrgFile,
} from "@shared";
import { WindowManager } from "../window-manager";
import {
  publishDownloadCompleteNotification,
  publishDownloadHaltedNotification,
} from "../notifications";
import type { Download, DownloadProgress, Game, UserPreferences } from "@types";
import {
  GofileApi,
  DatanodesApi,
  MediafireApi,
  PixelDrainApi,
  FuckingFastApi,
  VikingFileApi,
  RootzApi,
} from "../hosters";
import { TorrentService } from "../torrent-service";
import {
  LibtorrentPayload,
  LibtorrentStatus,
  PauseDownloadPayload,
} from "./types";
import { calculateETA, getDirSize } from "./helpers";
import { extractDownloadFilename } from "./download-filename";
import { RealDebridClient } from "./real-debrid";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { logger } from "../logger";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { TorBoxClient } from "./torbox";
import { selectTorBoxFiles } from "./torbox-files";
import { GameFilesManager } from "../game-files-manager";
import { PremiumizeClient } from "./premiumize";
import { AllDebridClient } from "./all-debrid";
import { isZipDownloadUrl } from "./debrid-files";
import { getJsBatchProgress, sampleJsBatchSpeed } from "./js-batch-progress";
import { getRangeSizeForRequestBudget } from "./parallel-range-download";
import {
  DEFAULT_DOWNLOAD_USER_AGENT,
  JsHttpDownloader,
} from "./js-http-downloader";
import {
  clampProgress,
  isRetryableHttpStatus,
} from "./js-http-downloader-helpers";
import { getDirectorySize } from "@main/events/helpers/get-directory-size";
import {
  getDownloadLayoutStateRecord,
  getNextQueuedDownloadFromLayout,
  setDownloadLayoutQueues,
} from "../download-layout-state";
import { shouldFinalizeDownload } from "./download-completion";
import { describeErrorCause } from "@main/helpers/download-error-handler";
import {
  DISK_SPACE_CHECK_INTERVAL_MS,
  getDownloadDiskSpace,
} from "./disk-space";

interface JsDownloadOptions {
  url: string;
  savePath: string;
  filename?: string;
  headers?: Record<string, string>;
  allowParallelRanges?: boolean;
  parallelRangeConnections?: number;
  totalSize?: number;
}

interface PreparedJsDownload {
  uri: string;
  resolvedAt: number;
  options: JsDownloadOptions;
}

interface JsBatchEntry {
  url?: string;
  filename: string;
  size?: number;
  isLocked?: boolean;
  fileId?: number;
  isZip?: boolean;
  fileIndex?: number;
  sourcePath?: string;
  chunks?: number;
}

interface JsBatchState {
  provider: "allDebrid" | "torBox" | "realDebrid" | "premiumize";
  downloadId: string;
  savePath: string;
  entries: JsBatchEntry[];
  torrentId?: number;
  sourceUri?: string;
  rootFolderName?: string;
  currentIndex: number;
  activeIndex: number;
  completedBytes: number;
  totalBytes: number;
  lastSpeedUpdate: number;
  bytesAtLastSpeedUpdate: number | null;
  batchSpeed: number;
}

const TORBOX_MAX_PARALLEL_RANGES = 256;
const REAL_DEBRID_MAX_CONNECTIONS = 8;

function realDebridConnections(chunks: number | undefined): number {
  if (!Number.isInteger(chunks) || !chunks || chunks < 1) return 4;
  return Math.min(chunks, REAL_DEBRID_MAX_CONNECTIONS);
}

export class DownloadManager {
  private static downloadingGameId: string | null = null;
  private static jsDownloader: JsHttpDownloader | null = null;
  private static usingJsDownloader = false;
  private static isPreparingDownload = false;
  private static jsBatch: JsBatchState | null = null;
  private static maxDownloadSpeedBytesPerSecond: number | null = null;
  private static startGeneration = 0;
  private static orphanedDownloadCandidate: {
    downloadKey: string;
    generation: number;
  } | null = null;
  private static lastDiskSpaceCheck: {
    downloadKey: string;
    timestamp: number;
  } | null = null;
  private static queueHeldForDiskSpace = false;
  private static lastQueueRetry = 0;
  private static readonly preparedJsDownloads = new Map<
    string,
    PreparedJsDownload
  >();
  private static readonly PREPARED_JS_DOWNLOAD_TTL_MS = 120_000;

  public static hasActiveDownload() {
    return this.downloadingGameId !== null;
  }

  public static get isJsDownloadActive(): boolean {
    return (
      this.usingJsDownloader &&
      this.jsDownloader !== null &&
      this.downloadingGameId !== null
    );
  }

  public static getActiveDownloadId(): string | null {
    return this.downloadingGameId;
  }

  public static notifyReconnecting(value: boolean): void {
    if (this.usingJsDownloader && this.jsDownloader) {
      this.jsDownloader.setReconnecting(value);
    }
  }

  public static reconnectActiveDownload(): void {
    if (this.usingJsDownloader && this.jsDownloader) {
      this.jsDownloader.reconnect();
    }
  }

  public static isActiveDownloadReconnecting(): boolean {
    return (
      this.usingJsDownloader &&
      this.jsDownloader !== null &&
      this.jsDownloader.getDownloadStatus()?.isReconnecting === true
    );
  }

  private static extractFilename(
    url: string,
    originalUrl?: string
  ): string | undefined {
    return extractDownloadFilename(url, originalUrl);
  }

  private static sanitizeFilename(filename: string): string {
    return filename.replaceAll(/[<>:"/\\|?*]/g, "_");
  }

  private static sanitizeRelativePath(pathValue: string): string {
    return pathValue
      .split(/[\\/]+/)
      .filter((segment) => segment !== "." && segment !== "..")
      .map((segment) => this.sanitizeFilename(segment))
      .filter(Boolean)
      .join("/");
  }

  private static assertSafeBatchPath(savePath: string, filename: string) {
    const root = path.resolve(savePath);
    const target = path.resolve(root, filename);
    if (!target.startsWith(root + path.sep)) {
      throw new Error("The download file path is outside the selected folder.");
    }

    for (let parent = target; parent !== root; parent = path.dirname(parent)) {
      try {
        if (fs.lstatSync(parent).isSymbolicLink()) {
          throw new Error("The download file path contains a symbolic link.");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private static resolveFilename(
    resumingFilename: string | undefined,
    originalUrl: string,
    downloadUrl: string
  ): string | undefined {
    if (resumingFilename) return resumingFilename;

    const extracted =
      this.extractFilename(originalUrl, downloadUrl) ||
      this.extractFilename(downloadUrl);

    return extracted ? this.sanitizeFilename(extracted) : undefined;
  }

  private static buildDownloadOptions(
    url: string,
    savePath: string,
    filename: string | undefined,
    headers?: Record<string, string>
  ) {
    return {
      url,
      savePath,
      filename,
      headers,
    };
  }

  private static parseGofileUri(uri: string) {
    let normalizedUri = uri.trim();

    if (
      !normalizedUri.startsWith("http://") &&
      !normalizedUri.startsWith("https://")
    ) {
      normalizedUri = `https://${normalizedUri}`;
    }

    try {
      const parsed = new URL(normalizedUri);
      const id = parsed.pathname.split("/").filter(Boolean).pop() || "";
      const password = parsed.searchParams.get("password") || undefined;

      return {
        id,
        password,
      };
    } catch {
      const id =
        normalizedUri.split("?")[0].split("/").filter(Boolean).pop() || "";
      return {
        id,
        password: undefined,
      };
    }
  }

  private static logResolvedUrl(url: string): void {
    let sanitizedUrl = url;

    try {
      const parsedUrl = new URL(url);
      sanitizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
      sanitizedUrl = url.replace(/[?#].*$/, "");
    }

    logger.log(`[DownloadManager] Resolved URL: ${sanitizedUrl}`);
  }

  private static createDownloadPayload(
    directUrl: string,
    originalUrl: string,
    downloadId: string,
    savePath: string
  ) {
    const filename =
      this.extractFilename(originalUrl, directUrl) ||
      this.extractFilename(directUrl);
    const sanitizedFilename = filename
      ? this.sanitizeFilename(filename)
      : undefined;

    if (sanitizedFilename) {
      logger.log(`[DownloadManager] Using filename: ${sanitizedFilename}`);
    } else {
      logger.log(
        `[DownloadManager] No filename extracted, downloader will use default`
      );
    }

    return {
      action: "start" as const,
      game_id: downloadId,
      url: directUrl,
      save_path: savePath,
      out: sanitizedFilename,
      allow_multiple_connections: true,
    };
  }

  private static isHttpDownloader(downloader: Downloader): boolean {
    return downloader !== Downloader.Torrent;
  }

  private static normalizeDownloadSpeedLimit(
    value?: number | null
  ): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.floor(value);
  }

  private static async getPersistedDownloadSpeedLimit() {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    return this.normalizeDownloadSpeedLimit(
      userPreferences?.maxDownloadSpeedBytesPerSecond
    );
  }

  public static async applyDownloadSpeedLimit(
    value?: number | null
  ): Promise<void> {
    const normalizedLimit =
      value === undefined
        ? await this.getPersistedDownloadSpeedLimit()
        : this.normalizeDownloadSpeedLimit(value);

    this.maxDownloadSpeedBytesPerSecond = normalizedLimit;
    this.jsDownloader?.setMaxDownloadSpeedBytesPerSecond(normalizedLimit);

    await TorrentService.call("action", {
      action: "set_download_limit",
      max_download_speed_bytes_per_second: normalizedLimit,
    }).catch((error) => {
      logger.error(
        "[DownloadManager] Failed to update torrent download speed limit:",
        error
      );
    });
  }

  private static async getPersistedNetworkInterface() {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    return userPreferences?.torrentNetworkInterface ?? null;
  }

  private static resolveNetworkInterfaceBinding(name: string | null): string {
    if (!name) return "";

    const addresses = os.networkInterfaces()[name] ?? [];
    const usable = addresses.filter(
      (address) =>
        !address.internal &&
        !(
          address.family === "IPv6" &&
          address.address.toLowerCase().startsWith("fe80")
        )
    );

    if (usable.length === 0) return name;

    return usable.map((address) => address.address).join(",");
  }

  public static async applyNetworkInterface(
    value?: string | null
  ): Promise<void> {
    const networkInterface =
      value ?? (await this.getPersistedNetworkInterface());

    await TorrentService.call("action", {
      action: "set_network_interface",
      interface: this.resolveNetworkInterfaceBinding(networkInterface),
    }).catch((error) => {
      logger.error(
        "[DownloadManager] Failed to update torrent network interface:",
        error
      );
    });
  }

  public static async initializeTorrentService(
    download?: Download,
    downloadsToSeed?: Download[]
  ) {
    await TorrentService.initialize();

    await this.applyNetworkInterface();

    if (downloadsToSeed?.length) {
      for (const seedDownload of downloadsToSeed) {
        await this.resumeSeeding(seedDownload).catch((error) => {
          logger.error("[DownloadManager] Failed to resume seeding", error);
        });
      }
    }

    if (download) {
      await this.startDownload(download).catch((error) => {
        logger.error("[DownloadManager] Failed to resume download", error);
      });
    }

    await this.applyDownloadSpeedLimit();
  }

  private static async getDownloadStatusFromJs(): Promise<DownloadProgress | null> {
    if (!this.downloadingGameId) return null;

    const downloadId = this.downloadingGameId;

    // Return a "preparing" status while fetching download options
    if (this.isPreparingDownload) {
      try {
        const download = await downloadsSublevel.get(downloadId);
        if (!download) return null;

        return {
          numPeers: 0,
          numSeeds: 0,
          downloadSpeed: 0,
          timeRemaining: -1,
          isDownloadingMetadata: true, // Use this to indicate "preparing"
          isCheckingFiles: false,
          progress: 0,
          gameId: downloadId,
          download,
        };
      } catch {
        return null;
      }
    }

    if (!this.jsDownloader) return null;

    const status = this.jsDownloader.getDownloadStatus();
    if (!status) return null;

    try {
      const download = await downloadsSublevel.get(downloadId);
      if (!download) return null;

      let { progress, bytesDownloaded, fileSize, folderName } = status;
      let downloadSpeed = status.downloadSpeed;
      let batchFilesTotal: number | undefined;
      let batchFilesDownloaded: number | undefined;

      if (this.jsBatch && this.jsBatch.downloadId === downloadId) {
        const batch = this.jsBatch;
        const batchDone =
          batch.currentIndex >= batch.entries.length &&
          status.status === "complete";

        batchFilesTotal = batch.entries.length;

        if (batchDone) {
          this.jsBatch = null;
          progress = 1;
          bytesDownloaded = batch.completedBytes;
          fileSize = batch.totalBytes;
          folderName = batch.rootFolderName ?? folderName;
          batchFilesDownloaded = batchFilesTotal;
        } else {
          if (status.status === "complete") {
            status.status = "active";
          }

          const batchProgress = getJsBatchProgress({
            currentIndex: batch.currentIndex,
            activeIndex: batch.activeIndex,
            completedBytes: batch.completedBytes,
            totalBytes: batch.totalBytes,
            entryCount: batch.entries.length,
            fileBytes: status.bytesDownloaded,
            fileProgress: status.progress,
          });
          progress = batchProgress.progress;
          const currentBytes = batchProgress.currentBytes;
          bytesDownloaded = batch.completedBytes + currentBytes;
          fileSize = batch.totalBytes || fileSize;
          folderName =
            batch.rootFolderName ??
            batch.entries[batch.currentIndex]?.filename ??
            folderName;
          batchFilesDownloaded = batch.currentIndex;

          // Compute batch-level speed so small files don't reset the reading
          const speedSample = sampleJsBatchSpeed(
            batch,
            bytesDownloaded,
            status.isRecovering ? 0 : status.downloadSpeed,
            Date.now()
          );
          batch.lastSpeedUpdate = speedSample.lastSpeedUpdate;
          batch.bytesAtLastSpeedUpdate = speedSample.bytesAtLastSpeedUpdate;
          batch.batchSpeed = speedSample.batchSpeed;
          downloadSpeed = batch.batchSpeed;
        }
      }

      progress = clampProgress(progress);

      const effectiveFileSize = fileSize > 0 ? fileSize : download.fileSize;

      const updatedDownload = {
        ...download,
        bytesDownloaded,
        fileSize: effectiveFileSize,
        progress,
        folderName,
        status:
          status.status === "complete"
            ? ("complete" as const)
            : ("active" as const),
      };

      if (status.status === "active" || status.status === "complete") {
        await downloadsSublevel.put(downloadId, updatedDownload);
      }

      return {
        numPeers: 0,
        numSeeds: 0,
        downloadSpeed,
        timeRemaining: calculateETA(
          effectiveFileSize ?? 0,
          bytesDownloaded,
          downloadSpeed
        ),
        isDownloadingMetadata: false,
        isCheckingFiles: false,
        isReconnecting: status.isReconnecting,
        isRecovering: status.isRecovering,
        recoveryProgress: status.recoveryProgress,
        progress,
        gameId: downloadId,
        download: updatedDownload,
        batchFilesTotal,
        batchFilesDownloaded,
      };
    } catch (err) {
      logger.error("[DownloadManager] Error getting JS download status:", err);
      return null;
    }
  }

  private static async getDownloadStatusFromRpc(): Promise<DownloadProgress | null> {
    let response: { data: LibtorrentPayload | null };

    try {
      response = await TorrentService.call<LibtorrentPayload | null>("status");
    } catch (error) {
      logger.error("[DownloadManager] Torrent status poll failed", error);
      return null;
    }

    if (response.data === null || !this.downloadingGameId) return null;
    const downloadId = this.downloadingGameId;

    try {
      const {
        progress,
        numPeers,
        numSeeds,
        downloadSpeed,
        bytesDownloaded,
        fileSize,
        folderName,
        status,
      } = response.data;

      const isDownloadingMetadata =
        status === LibtorrentStatus.DownloadingMetadata;
      const isCheckingFiles = status === LibtorrentStatus.CheckingFiles;

      const download = await downloadsSublevel.get(downloadId);

      if (!isDownloadingMetadata && !isCheckingFiles) {
        if (!download) return null;

        const effectiveFileSize =
          fileSize > 0
            ? fileSize
            : (download.selectedFilesSize ?? download.fileSize ?? 0);

        await downloadsSublevel.put(downloadId, {
          ...download,
          bytesDownloaded,
          fileSize: effectiveFileSize,
          progress,
          folderName,
          status: "active",
        });
      }

      return {
        numPeers,
        numSeeds,
        downloadSpeed,
        timeRemaining: calculateETA(
          fileSize > 0
            ? fileSize
            : (download?.selectedFilesSize ?? download?.fileSize ?? 0),
          bytesDownloaded,
          downloadSpeed
        ),
        isDownloadingMetadata,
        isCheckingFiles,
        progress,
        gameId: downloadId,
        download,
      } as DownloadProgress;
    } catch {
      return null;
    }
  }

  private static async getDownloadStatus(): Promise<DownloadProgress | null> {
    if (this.usingJsDownloader) {
      return this.getDownloadStatusFromJs();
    }
    return this.getDownloadStatusFromRpc();
  }

  private static async cancelOrphanedDownload(downloadKey: string) {
    if (
      this.orphanedDownloadCandidate?.downloadKey !== downloadKey ||
      this.orphanedDownloadCandidate.generation !== this.startGeneration
    ) {
      this.orphanedDownloadCandidate = {
        downloadKey,
        generation: this.startGeneration,
      };
      return;
    }

    this.orphanedDownloadCandidate = null;

    logger.warn(
      `[DownloadManager] Download entry for ${downloadKey} no longer exists, cancelling orphaned download`
    );

    await this.cancelDownload(downloadKey);
  }

  public static async watchDownloads() {
    const activeDownloadKey = this.downloadingGameId;

    if (activeDownloadKey) {
      const activeDownload = await downloadsSublevel.get(activeDownloadKey);

      if (!activeDownload) {
        await this.cancelOrphanedDownload(activeDownloadKey);
        return;
      }
    }

    this.orphanedDownloadCandidate = null;

    if (this.queueHeldForDiskSpace) {
      await this.retryQueueHeldForDiskSpace();
    }

    const status = await this.getDownloadStatus();
    if (!status) return;

    const { gameId, progress } = status;
    const [download, game] = await Promise.all([
      downloadsSublevel.get(gameId),
      gamesSublevel.get(gameId),
    ]);

    if (!download || !game) return;

    if (await this.haltDownloadIfStorageIsFull(download, game, gameId)) return;

    this.sendProgressUpdate(progress, status, game);

    if (
      shouldFinalizeDownload({
        usingJsDownloader: this.usingJsDownloader,
        isCheckingFiles: status.isCheckingFiles,
        isDownloadingMetadata: status.isDownloadingMetadata,
        progress,
        downloadStatus: download.status,
      })
    ) {
      await this.handleDownloadCompletion(download, game, gameId);
    }
  }

  private static async retryQueueHeldForDiskSpace() {
    const now = Date.now();

    if (now - this.lastQueueRetry < DISK_SPACE_CHECK_INTERVAL_MS) return;

    this.lastQueueRetry = now;

    await this.processNextQueuedDownload();
  }

  private static async haltDownloadIfStorageIsFull(
    download: Download,
    game: Game,
    downloadKey: string
  ) {
    if (download.progress >= 1) return false;

    const now = Date.now();

    if (
      this.lastDiskSpaceCheck?.downloadKey === downloadKey &&
      now - this.lastDiskSpaceCheck.timestamp < DISK_SPACE_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    this.lastDiskSpaceCheck = { downloadKey, timestamp: now };

    const diskSpace = await getDownloadDiskSpace(download);

    if (!diskSpace) {
      logger.error(
        `[DownloadManager] Failed to read free space for ${download.downloadPath}`
      );
      return false;
    }

    if (diskSpace.hasEnoughSpace) return false;

    logger.warn(
      `[DownloadManager] Halting ${downloadKey}: ${download.downloadPath} has ${diskSpace.freeBytes} bytes free, ${diskSpace.requiredBytes} needed`
    );

    this.lastDiskSpaceCheck = null;

    await this.pauseDownload(downloadKey);
    WindowManager.sendToAppWindows("on-download-progress", null);

    await downloadsSublevel.put(downloadKey, {
      ...download,
      status: "error",
      queued: false,
      pinnedToHero: false,
      extracting: false,
    });

    const downloads = await downloadsSublevel.values().all();
    const layoutState = await getDownloadLayoutStateRecord();
    await setDownloadLayoutQueues(
      downloads,
      layoutState.queueOrder.filter((id) => id !== downloadKey),
      [
        downloadKey,
        ...layoutState.pausedOrder.filter((id) => id !== downloadKey),
      ]
    );

    WindowManager.sendDownloadsUpdated();
    WindowManager.sendToAppWindows("on-download-halted", game.title);

    await publishDownloadHaltedNotification(game).catch((error) => {
      logger.error(
        "[DownloadManager] Failed to publish download halted notification",
        error
      );
    });

    await this.processNextQueuedDownload();

    return true;
  }

  private static sendProgressUpdate(
    progress: number,
    status: DownloadProgress,
    game: Game
  ) {
    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);
    }

    WindowManager.sendToAppWindows(
      "on-download-progress",
      structuredClone({ ...status, game })
    );
  }

  private static async handleDownloadCompletion(
    download: Download,
    game: Game,
    gameId: string
  ) {
    publishDownloadCompleteNotification(game);

    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    const shouldSeed = await this.updateDownloadStatus(
      download,
      gameId,
      userPreferences?.seedAfterDownloadComplete
    );

    // Calculate installer size in background
    if (download.folderName) {
      const installerPath = path.join(
        download.downloadPath,
        download.folderName
      );

      getDirectorySize(installerPath).then(async (installerSizeInBytes) => {
        const currentGame = await gamesSublevel.get(gameId);
        if (!currentGame) return;

        await gamesSublevel.put(gameId, {
          ...currentGame,
          installerSizeInBytes,
        });
      });
    }

    if (download.automaticallyExtract) {
      const shouldPauseSeedingForExtraction =
        shouldSeed && download.downloader === Downloader.Torrent;

      if (shouldPauseSeedingForExtraction) {
        await this.cancelDownload(gameId);

        void this.handleExtraction(download, game).finally(() => {
          this.resumeSeeding(download).catch((error) => {
            logger.error(
              "[DownloadManager] Failed to resume seeding after extraction",
              error
            );
          });
        });
      } else {
        void this.handleExtraction(download, game);
      }
    } else {
      const gameFilesManager = new GameFilesManager(game.shop, game.objectId);
      gameFilesManager.searchAndBindExecutable();
      void gameFilesManager.autoLinkClassicsDiscs();
    }

    await this.processNextQueuedDownload();
  }

  private static async updateDownloadStatus(
    download: Download,
    gameId: string,
    shouldSeed?: boolean
  ): Promise<boolean> {
    const shouldExtract = download.automaticallyExtract;
    const isSelectiveTorrent =
      download.downloader === Downloader.Torrent &&
      Array.isArray(download.fileIndices) &&
      download.fileIndices.length > 0;

    if (
      shouldSeed &&
      download.downloader === Downloader.Torrent &&
      !isSelectiveTorrent
    ) {
      await downloadsSublevel.put(gameId, {
        ...download,
        status: "seeding",
        shouldSeed: true,
        queued: false,
        pinnedToHero: false,
        extracting: shouldExtract,
      });
      WindowManager.sendDownloadsUpdated();

      return true;
    } else {
      await downloadsSublevel.put(gameId, {
        ...download,
        status: "complete",
        shouldSeed: false,
        queued: false,
        pinnedToHero: false,
        extracting: shouldExtract,
      });
      WindowManager.sendDownloadsUpdated();
      await this.cancelDownload(gameId);

      return false;
    }
  }

  private static async handleExtraction(download: Download, game: Game) {
    const gameFilesManager = new GameFilesManager(game.shop, game.objectId);
    const extractionPath = download.folderName
      ? path.join(download.downloadPath, download.folderName)
      : null;

    if (!extractionPath || !fs.existsSync(extractionPath)) {
      await gameFilesManager
        .failMissingExtractionSource(extractionPath ?? undefined)
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to persist extraction failure state",
            error
          );
        });
      return;
    }

    const extractionStats = fs.statSync(extractionPath);

    if (
      extractionStats.isFile() &&
      FILE_EXTENSIONS_TO_EXTRACT.some((ext) =>
        download.folderName?.toLowerCase().endsWith(ext)
      )
    ) {
      await gameFilesManager.extractDownloadedFile().catch((error) => {
        logger.error(
          "[DownloadManager] Failed to extract downloaded file",
          error
        );
        return gameFilesManager.failExtraction(error).catch((failError) => {
          logger.error(
            "[DownloadManager] Failed to persist extraction failure state",
            failError
          );
        });
      });
    } else if (extractionStats.isDirectory()) {
      await gameFilesManager
        .extractFilesInDirectory(extractionPath)
        .then(async (success) => {
          if (success) {
            await gameFilesManager.setExtractionComplete();
          }
        })
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to extract files in directory",
            error
          );
          return gameFilesManager.failExtraction(error).catch((failError) => {
            logger.error(
              "[DownloadManager] Failed to persist extraction failure state",
              failError
            );
          });
        });
    } else if (extractionStats.isFile()) {
      await gameFilesManager
        .handleUnsupportedExtraction(extractionPath, { notify: false })
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to handle unsupported extraction format",
            error
          );
        });
    } else {
      await gameFilesManager
        .failExtraction(
          new Error(
            `Invalid extraction source type for "${download.folderName ?? "unknown"}"`
          )
        )
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to persist extraction failure state",
            error
          );
        });
    }
  }

  private static async processNextQueuedDownload() {
    const downloads = await downloadsSublevel.values().all();
    const layoutState = await getDownloadLayoutStateRecord();
    const nextItemOnQueue = getNextQueuedDownloadFromLayout(
      downloads,
      layoutState
    );

    if (nextItemOnQueue) {
      const diskSpace = await getDownloadDiskSpace(nextItemOnQueue);

      if (diskSpace && !diskSpace.hasEnoughSpace) {
        if (!this.queueHeldForDiskSpace) {
          logger.warn(
            `[DownloadManager] Keeping the queue on hold: ${nextItemOnQueue.downloadPath} has ${diskSpace.freeBytes} bytes free, ${diskSpace.requiredBytes} needed`
          );
          WindowManager.sendDownloadsUpdated();
        }

        this.queueHeldForDiskSpace = true;
        return;
      }

      this.queueHeldForDiskSpace = false;

      const nextDownloadId = levelKeys.game(
        nextItemOnQueue.shop,
        nextItemOnQueue.objectId
      );
      const activeDownload: Download = {
        ...nextItemOnQueue,
        status: "active",
        queued: false,
        pinnedToHero: false,
        extracting: false,
        extractionProgress: 0,
      };

      await downloadsSublevel.put(nextDownloadId, activeDownload);
      WindowManager.sendDownloadsUpdated();

      try {
        await this.resumeDownload(activeDownload);
      } catch (error) {
        await this.handleRuntimeDownloadError(nextDownloadId, error);
      }
    } else {
      this.queueHeldForDiskSpace = false;
      this.downloadingGameId = null;
      this.usingJsDownloader = false;
      this.jsDownloader = null;
      this.jsBatch = null;
    }
  }

  private static getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;

    try {
      return JSON.stringify(error) ?? "Unknown error";
    } catch {
      return "Unknown error";
    }
  }

  private static async handleRuntimeDownloadError(
    downloadId: string,
    error: unknown
  ) {
    if (this.downloadingGameId && this.downloadingGameId !== downloadId) {
      const message = this.getErrorMessage(error);
      logger.warn(
        `[DownloadManager] Ignoring stale download error for ${downloadId}: ${message}`
      );
      return;
    }

    const message = this.getErrorMessage(error);
    logger.error(
      `[DownloadManager] Download failed for ${downloadId}: ${message}`,
      error
    );

    this.downloadingGameId = null;
    this.isPreparingDownload = false;
    this.usingJsDownloader = false;
    this.jsDownloader = null;
    this.jsBatch = null;
    WindowManager.mainWindow?.setProgressBar(-1);
    WindowManager.sendToAppWindows("on-download-progress", null);

    try {
      const download = await downloadsSublevel.get(downloadId);
      if (download) {
        await downloadsSublevel.put(downloadId, {
          ...download,
          status: "error",
          queued: false,
          pinnedToHero: false,
          extracting: false,
        });

        const downloads = await downloadsSublevel.values().all();
        const layoutState = await getDownloadLayoutStateRecord();
        await setDownloadLayoutQueues(
          downloads,
          layoutState.queueOrder.filter((id) => id !== downloadId),
          [
            downloadId,
            ...layoutState.pausedOrder.filter((id) => id !== downloadId),
          ]
        );
      }
    } catch (persistError) {
      logger.error(
        `[DownloadManager] Failed to persist download error for ${downloadId}`,
        persistError
      );
    }

    WindowManager.sendDownloadsUpdated();
    await this.processNextQueuedDownload();
  }

  public static async getSeedStatus() {
    let seedStatus: LibtorrentPayload[] = [];

    try {
      seedStatus = await TorrentService.call<LibtorrentPayload[] | []>(
        "seed_status"
      ).then((res) => res.data);
    } catch (error) {
      logger.error("[DownloadManager] Torrent seed status poll failed", error);
      WindowManager.sendToAppWindows("on-seeding-status", []);
      return;
    }

    if (!seedStatus.length) {
      WindowManager.sendToAppWindows("on-seeding-status", []);
      return;
    }

    logger.log(seedStatus);

    for (const status of seedStatus) {
      const download = await downloadsSublevel.get(status.gameId);

      if (!download) continue;

      const totalSize = await getDirSize(
        path.join(download.downloadPath, status.folderName)
      );

      if (totalSize < status.fileSize) {
        await this.pauseSeeding(status.gameId);

        await downloadsSublevel.put(status.gameId, {
          ...download,
          status: "paused",
          shouldSeed: false,
          pinnedToHero: false,
          progress:
            status.fileSize > 0
              ? Math.min(totalSize / status.fileSize, 1)
              : download.progress,
        });
        WindowManager.sendDownloadsUpdated();

        WindowManager.sendToAppWindows("on-hard-delete");
      }
    }

    WindowManager.sendToAppWindows("on-seeding-status", seedStatus);
  }

  static async pauseDownload(downloadKey = this.downloadingGameId) {
    if (this.usingJsDownloader && this.jsDownloader) {
      logger.log("[DownloadManager] Pausing JS download");
      const downloader = this.jsDownloader;
      downloader.pauseDownload();
      await downloader.waitForIdle();

      if (downloadKey && downloadKey === this.downloadingGameId) {
        const status = await this.getDownloadStatusFromJs();
        const download = await downloadsSublevel.get(downloadKey);
        if (status?.download && download) {
          await downloadsSublevel.put(downloadKey, {
            ...download,
            bytesDownloaded: status.download.bytesDownloaded,
            progress: status.download.progress,
          });
        }
      }
    } else if (downloadKey) {
      await TorrentService.call("action", {
        action: "pause",
        game_id: downloadKey,
      } as PauseDownloadPayload).catch(() => {});
    }

    if (downloadKey === this.downloadingGameId) {
      WindowManager.mainWindow?.setProgressBar(-1);
      this.downloadingGameId = null;
    }
  }

  static async resumeDownload(download: Download) {
    return this.startDownload(download);
  }

  static async cancelDownload(downloadKey = this.downloadingGameId) {
    const isActiveDownload = downloadKey === this.downloadingGameId;

    if (isActiveDownload) {
      // Invalidate any in-flight startDownload preparation for this slot so a
      // late-resolving prepare cannot spawn a downloader after cancellation.
      this.startGeneration += 1;

      if (this.usingJsDownloader && this.jsDownloader) {
        logger.log("[DownloadManager] Cancelling JS download");
        this.jsDownloader.cancelDownload();
        this.jsDownloader = null;
        this.usingJsDownloader = false;
        this.jsBatch = null;
      } else {
        await TorrentService.call("action", {
          action: "cancel",
          game_id: downloadKey,
        }).catch((err) => logger.error("Failed to cancel game download", err));
      }

      WindowManager.mainWindow?.setProgressBar(-1);
      WindowManager.sendToAppWindows("on-download-progress", null);
      this.downloadingGameId = null;
      this.isPreparingDownload = false;
      this.usingJsDownloader = false;
      this.jsBatch = null;
    } else if (downloadKey) {
      await TorrentService.call("action", {
        action: "cancel",
        game_id: downloadKey,
      }).catch((err) => logger.error("Failed to cancel game download", err));
    }
  }

  static async resumeSeeding(download: Download) {
    await TorrentService.call("action", {
      action: "resume_seeding",
      game_id: levelKeys.game(download.shop, download.objectId),
      url: download.uri,
      save_path: download.downloadPath,
      trackers: download.customTrackers,
    });
  }

  static async pauseSeeding(downloadKey: string) {
    await TorrentService.call("action", {
      action: "pause_seeding",
      game_id: downloadKey,
    });
  }

  private static async getJsDownloadOptions(
    download: Download
  ): Promise<JsDownloadOptions | null> {
    const resumingFilename = download.folderName || undefined;

    switch (download.downloader) {
      case Downloader.Gofile:
        return this.getGofileDownloadOptions(download, resumingFilename);
      case Downloader.PixelDrain:
        return this.getPixelDrainDownloadOptions(download, resumingFilename);
      case Downloader.Datanodes:
        return this.getDatanodesDownloadOptions(download, resumingFilename);
      case Downloader.FuckingFast:
        return this.getFuckingFastDownloadOptions(download, resumingFilename);
      case Downloader.Mediafire:
        return this.getMediafireDownloadOptions(download, resumingFilename);
      case Downloader.RealDebrid:
        return this.getRealDebridDownloadOptions(download, resumingFilename);
      case Downloader.Premiumize:
        return this.getPremiumizeDownloadOptions(download, resumingFilename);
      case Downloader.AllDebrid:
        return this.getAllDebridDownloadOptions(download, resumingFilename);
      case Downloader.TorBox:
        return this.getTorBoxDownloadOptions(download);
      case Downloader.Hydra:
        throw new Error(DownloadError.NotCachedOnHydra);
      case Downloader.VikingFile:
        return this.getVikingFileDownloadOptions(download, resumingFilename);
      case Downloader.Rootz:
        return this.getRootzDownloadOptions(download, resumingFilename);
      case Downloader.ArchiveOrg:
        return this.getArchiveOrgDownloadOptions(download, resumingFilename);
      default:
        return null;
    }
  }

  private static async runJsBatch() {
    while (this.jsBatch && this.jsDownloader) {
      const batch = this.jsBatch;
      const downloader = this.jsDownloader;
      const entry = batch.entries[batch.currentIndex];
      if (!entry) break;

      try {
        let resolvedUrl: string | undefined = entry.url;
        this.assertSafeBatchPath(batch.savePath, entry.filename);
        if (batch.provider === "torBox") {
          if (batch.torrentId === undefined || entry.fileId === undefined) {
            throw new Error("The TorBox file selection is incomplete.");
          }
          resolvedUrl = await TorBoxClient.requestLink(
            batch.torrentId,
            entry.isZip ? "zip" : entry.fileId
          );
        } else if (
          batch.provider === "realDebrid" &&
          entry.isLocked &&
          resolvedUrl
        ) {
          const unlocked = await RealDebridClient.unlockFileWithDetails(
            resolvedUrl,
            entry.sourcePath ?? entry.filename,
            entry.size ?? 0
          );
          resolvedUrl = unlocked.url;
          entry.chunks = unlocked.chunks;
        } else if (
          batch.provider === "allDebrid" &&
          entry.isLocked &&
          resolvedUrl
        ) {
          resolvedUrl = await AllDebridClient.unlockDownloadLink(resolvedUrl);
        } else if (
          batch.provider === "premiumize" &&
          batch.sourceUri &&
          entry.fileIndex !== undefined
        ) {
          const freshEntries = await PremiumizeClient.getDownloadEntries(
            batch.sourceUri,
            [entry.fileIndex]
          );
          resolvedUrl = freshEntries?.[0]?.url;
        }

        if (this.jsBatch !== batch || this.jsDownloader !== downloader) break;
        if (!resolvedUrl) throw new Error("The download link is unavailable.");

        const torBoxTorrentId = batch.torrentId;
        const torBoxFileId = entry.isZip ? "zip" : entry.fileId;
        const torBoxParallel = batch.provider === "torBox" && !entry.isZip;
        const options = {
          url: resolvedUrl,
          refreshUrl:
            batch.provider === "torBox" &&
            torBoxTorrentId !== undefined &&
            torBoxFileId !== undefined
              ? () => TorBoxClient.requestLink(torBoxTorrentId, torBoxFileId)
              : undefined,
          savePath: batch.savePath,
          allowParallelRanges:
            !entry.isZip && !isZipDownloadUrl(resolvedUrl, entry.filename),
          parallelRangeSize: torBoxParallel
            ? getRangeSizeForRequestBudget(
                entry.size ?? 0,
                TORBOX_MAX_PARALLEL_RANGES
              )
            : undefined,
          parallelRangeConnections:
            batch.provider === "realDebrid"
              ? realDebridConnections(entry.chunks)
              : undefined,
          maxParallelRanges: torBoxParallel
            ? TORBOX_MAX_PARALLEL_RANGES
            : undefined,
          preserveFilename: true,
          // Verify a regenerated ZIP's saved prefix before appending new data.
          verifyResumePrefix: Boolean(entry.isZip),
          filename:
            batch.provider === "torBox"
              ? entry.filename
              : this.sanitizeRelativePath(entry.filename),
        };

        this.logResolvedUrl(options.url);
        batch.activeIndex = batch.currentIndex;
        await downloader.startDownload(options);

        if (this.jsBatch !== batch || this.jsDownloader !== downloader) break;

        const dlStatus = downloader.getDownloadStatus();
        if (
          !dlStatus ||
          dlStatus.status === "paused" ||
          dlStatus.status === "error"
        ) {
          break;
        }

        const expectedSize = entry.size ?? 0;
        const requiresExactSize =
          batch.provider === "torBox" ||
          batch.provider === "realDebrid" ||
          batch.provider === "premiumize";
        const sizeMismatch =
          !entry.isZip &&
          (requiresExactSize
            ? dlStatus.bytesDownloaded !== expectedSize
            : expectedSize > 0 &&
              dlStatus.bytesDownloaded < expectedSize * 0.95);
        if (sizeMismatch) {
          logger.error(
            `[DownloadManager] ${batch.provider} batch entry ${batch.currentIndex} size mismatch: ` +
              `downloaded=${dlStatus.bytesDownloaded} expected=${expectedSize}. ` +
              `The download URL may have returned an error page.`
          );
          const mismatchDownloadId = this.jsBatch?.downloadId;
          if (batch.provider === "torBox") {
            await fs.promises
              .unlink(path.join(batch.savePath, entry.filename))
              .catch(() => undefined);
          }
          if (this.jsBatch !== batch || this.jsDownloader !== downloader)
            return;
          this.cleanupBatch();
          if (mismatchDownloadId) {
            await this.handleRuntimeDownloadError(
              mismatchDownloadId,
              new Error(
                "A downloaded file returned fewer bytes than expected. Its link may have expired."
              )
            );
          }
          return;
        }

        if (entry.isZip && expectedSize !== dlStatus.bytesDownloaded) {
          batch.totalBytes += dlStatus.bytesDownloaded - expectedSize;
        }
        const bankedBytes =
          entry.isZip || !entry.size || entry.size <= 0
            ? dlStatus.bytesDownloaded
            : entry.size;
        batch.completedBytes += bankedBytes;
        batch.currentIndex += 1;
      } catch (err) {
        if (this.jsBatch !== batch || this.jsDownloader !== downloader) return;
        logger.error(
          `[DownloadManager] ${batch.provider} batch entry error:`,
          err
        );
        const failedDownloadId = this.jsBatch?.downloadId;
        this.cleanupBatch();
        if (failedDownloadId) {
          await this.handleRuntimeDownloadError(failedDownloadId, err);
        }
        return;
      }
    }
  }

  private static cleanupBatch() {
    this.usingJsDownloader = false;
    this.jsDownloader?.cancelDownload();
    this.jsDownloader = null;
    this.jsBatch = null;
    this.downloadingGameId = null;
    this.isPreparingDownload = false;
    WindowManager.mainWindow?.setProgressBar(-1);
  }

  private static async getGofileDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const { id, password } = this.parseGofileUri(download.uri);
    if (!id) {
      throw new Error("Invalid gofile URL");
    }

    const { url, headers } = await this.resolveGofileDownload(id, password);

    const filename = this.resolveFilename(resumingFilename, download.uri, url);
    return this.buildDownloadOptions(
      url,
      download.downloadPath,
      filename,
      headers
    );
  }

  private static async resolveGofileDownload(
    id: string,
    password?: string
  ): Promise<{
    url: string;
    headers?: Record<string, string>;
  }> {
    try {
      const downloadLink = await GofileApi.getDownloadLink(id, password);
      await GofileApi.checkDownloadUrl(downloadLink);
      const token = await GofileApi.authorize();

      logger.log(
        `[DownloadManager] GoFile download ${id} will use the official downloader`
      );

      return {
        url: downloadLink,
        headers: { Cookie: `accountToken=${token}` },
      };
    } catch (error) {
      logger.warn(
        `[DownloadManager] Official GoFile downloader failed for ${id}; checking alternate CDN`,
        error
      );

      const alternateCdnDownloadLink =
        await GofileApi.getAlternateCdnDownloadLinkIfAvailable(id);

      if (!alternateCdnDownloadLink) {
        throw error;
      }

      logger.log(
        `[DownloadManager] GoFile download ${id} will use alternate CDN`
      );

      return { url: alternateCdnDownloadLink };
    }
  }

  private static async getPixelDrainDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await PixelDrainApi.unlock(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getDatanodesDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await DatanodesApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getFuckingFastDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    logger.log(
      `[DownloadManager] Processing FuckingFast download for URI: ${download.uri}`
    );
    const directUrl = await FuckingFastApi.getDirectLink(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      directUrl
    );
    return this.buildDownloadOptions(
      directUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getMediafireDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await MediafireApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getRealDebridDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const resolved = await RealDebridClient.getDownloadEntriesWithTorrent(
      download.uri,
      download.fileIndices,
      download.realDebridTorrentId
    );
    if (resolved.torrentId) download.realDebridTorrentId = resolved.torrentId;
    const entries = resolved.entries;
    const first = entries?.[0];
    const downloadUrl = first
      ? first.isLocked
        ? await RealDebridClient.unlockFile(first.url, first.path, first.size)
        : first.url
      : null;
    if (!downloadUrl) throw new Error(DownloadError.NotCachedOnRealDebrid);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return {
      ...this.buildDownloadOptions(
        downloadUrl,
        download.downloadPath,
        filename
      ),
      allowParallelRanges: !isZipDownloadUrl(downloadUrl, first?.path),
      parallelRangeConnections: realDebridConnections(first?.chunks),
      totalSize: entries?.reduce((sum, entry) => sum + entry.size, 0),
    };
  }

  private static async getPremiumizeDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const entries = download.uri.startsWith("magnet:")
      ? await PremiumizeClient.getDownloadEntries(
          download.uri,
          download.fileIndices
        )
      : null;
    if (download.fileIndices?.length && !entries?.length) {
      if (
        entries === null &&
        (await PremiumizeClient.startTransferInBackground(download.uri))
      ) {
        throw new Error(DownloadError.PremiumizeTransferStarted);
      }
      throw new Error("The selected Premiumize files are no longer available.");
    }
    const downloadUrl =
      entries?.[0]?.url ??
      (await PremiumizeClient.getDownloadUrl(download.uri));
    if (!downloadUrl) throw new Error(DownloadError.NotCachedOnPremiumize);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return {
      ...this.buildDownloadOptions(
        downloadUrl,
        download.downloadPath,
        entries?.[0]?.path ?? filename
      ),
      allowParallelRanges: !isZipDownloadUrl(downloadUrl, entries?.[0]?.path),
      totalSize: entries?.reduce((sum, entry) => sum + entry.size, 0),
    };
  }

  private static async getAllDebridDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const entries = await AllDebridClient.getDownloadEntries(
      download.uri,
      download.fileIndices
    );
    const first = entries?.[0];
    const downloadInfo = first
      ? {
          url: first.isLocked
            ? await AllDebridClient.unlockDownloadLink(first.url)
            : first.url,
          filename: first.filename,
        }
      : null;
    if (!downloadInfo?.url) throw new Error(DownloadError.NotCachedOnAllDebrid);
    const filename = resumingFilename
      ? this.sanitizeRelativePath(resumingFilename)
      : downloadInfo.filename
        ? this.sanitizeRelativePath(downloadInfo.filename)
        : this.resolveFilename(undefined, download.uri, downloadInfo.url);
    return {
      ...this.buildDownloadOptions(
        downloadInfo.url,
        download.downloadPath,
        filename
      ),
      allowParallelRanges: !isZipDownloadUrl(downloadInfo.url, first?.filename),
      totalSize: entries?.reduce((sum, entry) => sum + entry.size, 0),
    };
  }

  private static async getTorBoxDownloadOptions(download: Download) {
    const manifest = await TorBoxClient.getDownloadFiles(download.uri);
    const selected = selectTorBoxFiles(manifest, download.fileIndices);
    const firstFile = selected[0];
    const url = await TorBoxClient.requestLink(
      manifest.torrentId,
      firstFile.isZip ? "zip" : firstFile.id
    );
    return {
      ...this.buildDownloadOptions(url, download.downloadPath, firstFile.path),
      totalSize: selected.reduce((sum, file) => sum + file.size, 0),
    };
  }

  private static async getVikingFileDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    logger.log(
      `[DownloadManager] Processing VikingFile download for URI: ${download.uri}`
    );
    const downloadUrl = await VikingFileApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getArchiveOrgDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const resolvedFile = resolveArchiveOrgFile(download.uri);
    if (!resolvedFile) throw new Error(DownloadError.ArchiveOrgInvalidFileUrl);

    return this.buildDownloadOptions(
      resolvedFile.url,
      download.downloadPath,
      resumingFilename ?? this.sanitizeFilename(resolvedFile.filename)
    );
  }

  private static async getRootzDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await RootzApi.getDownloadUrl(download.uri);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadUrl
    );
    return this.buildDownloadOptions(
      downloadUrl,
      download.downloadPath,
      filename
    );
  }

  private static async getDownloadPayload(download: Download) {
    const downloadId = levelKeys.game(download.shop, download.objectId);

    switch (download.downloader) {
      case Downloader.Gofile: {
        const { id, password } = this.parseGofileUri(download.uri);
        if (!id) {
          throw new Error("Invalid gofile URL");
        }

        const { url, headers } = await this.resolveGofileDownload(id, password);
        const payload = {
          action: "start" as const,
          game_id: downloadId,
          url,
          save_path: download.downloadPath,
          allow_multiple_connections: true,
          connections_limit: 8,
        };

        if (headers?.Cookie) {
          return {
            ...payload,
            header: `Cookie: ${headers.Cookie}`,
          };
        }

        return payload;
      }
      case Downloader.PixelDrain: {
        const downloadUrl = await PixelDrainApi.unlock(download.uri);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      case Downloader.Datanodes: {
        const downloadUrl = await DatanodesApi.getDownloadUrl(download.uri);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      case Downloader.FuckingFast: {
        logger.log(
          `[DownloadManager] Processing FuckingFast download for URI: ${download.uri}`
        );
        try {
          const directUrl = await FuckingFastApi.getDirectLink(download.uri);
          logger.log(`[DownloadManager] FuckingFast direct URL obtained`);
          return this.createDownloadPayload(
            directUrl,
            download.uri,
            downloadId,
            download.downloadPath
          );
        } catch (error) {
          logger.error(
            `[DownloadManager] Error processing FuckingFast download:`,
            error
          );
          throw error;
        }
      }
      case Downloader.Mediafire: {
        const downloadUrl = await MediafireApi.getDownloadUrl(download.uri);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      case Downloader.Torrent: {
        const hasSelectedFileIndices =
          Array.isArray(download.fileIndices) &&
          download.fileIndices.length > 0;

        return {
          action: "start",
          game_id: downloadId,
          url: download.uri,
          save_path: download.downloadPath,
          file_indices: hasSelectedFileIndices
            ? download.fileIndices
            : undefined,
          metadata_timeout_ms: hasSelectedFileIndices ? 60_000 : undefined,
          trackers: download.customTrackers,
        };
      }
      case Downloader.RealDebrid: {
        const downloadUrl = await RealDebridClient.getDownloadUrl(download.uri);
        if (!downloadUrl) throw new Error(DownloadError.NotCachedOnRealDebrid);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
          allow_multiple_connections: true,
        };
      }
      case Downloader.Premiumize: {
        const downloadUrl = await PremiumizeClient.getDownloadUrl(download.uri);
        if (!downloadUrl) throw new Error(DownloadError.NotCachedOnPremiumize);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
          allow_multiple_connections: true,
        };
      }
      case Downloader.AllDebrid: {
        const downloadInfo = await AllDebridClient.getDownloadInfo(
          download.uri
        );
        if (!downloadInfo?.url)
          throw new Error(DownloadError.NotCachedOnAllDebrid);

        const filename = downloadInfo.filename
          ? this.sanitizeRelativePath(downloadInfo.filename)
          : undefined;
        return {
          action: "start",
          game_id: downloadId,
          url: downloadInfo.url,
          save_path: download.downloadPath,
          out: filename,
          allow_multiple_connections: true,
        };
      }
      case Downloader.TorBox:
        throw new Error("TorBox folders require the HTTP download manager.");
      case Downloader.Hydra: {
        throw new Error(DownloadError.NotCachedOnHydra);
      }
      case Downloader.VikingFile: {
        logger.log(
          `[DownloadManager] Processing VikingFile download for URI: ${download.uri}`
        );
        const downloadUrl = await VikingFileApi.getDownloadUrl(download.uri);
        return this.createDownloadPayload(
          downloadUrl,
          download.uri,
          downloadId,
          download.downloadPath
        );
      }
      case Downloader.Rootz: {
        const downloadUrl = await RootzApi.getDownloadUrl(download.uri);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
        };
      }
      default:
        return undefined;
    }
  }

  static async validateDownloadUrl(download: Download): Promise<void> {
    if (!this.isHttpDownloader(download.downloader)) return;

    const downloadId = levelKeys.game(download.shop, download.objectId);
    this.preparedJsDownloads.delete(downloadId);

    const options =
      download.downloader === Downloader.TorBox
        ? await this.getTorBoxDownloadOptions(download)
        : await this.getJsDownloadOptions(download);
    if (!options) {
      throw new Error("Failed to validate download URL");
    }

    if (
      "totalSize" in options &&
      typeof options.totalSize === "number" &&
      options.totalSize > 0
    ) {
      download.fileSize = options.totalSize;
      download.selectedFilesSize = options.totalSize;
    }

    await this.validateJsDownloadResponse(options);

    this.prunePreparedJsDownloads();
    this.preparedJsDownloads.set(downloadId, {
      uri: download.uri,
      resolvedAt: Date.now(),
      options,
    });
  }

  private static prunePreparedJsDownloads() {
    for (const [key, prepared] of this.preparedJsDownloads) {
      if (Date.now() - prepared.resolvedAt > this.PREPARED_JS_DOWNLOAD_TTL_MS) {
        this.preparedJsDownloads.delete(key);
      }
    }
  }

  private static takePreparedJsDownload(
    download: Download,
    downloadId: string
  ): JsDownloadOptions | null {
    const prepared = this.preparedJsDownloads.get(downloadId);
    if (!prepared) return null;

    this.preparedJsDownloads.delete(downloadId);

    if (prepared.uri !== download.uri) return null;
    if (Date.now() - prepared.resolvedAt > this.PREPARED_JS_DOWNLOAD_TTL_MS) {
      return null;
    }

    return prepared.options;
  }

  private static buildPreflightHeaders(
    base?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = { ...base };

    const hasUserAgentHeader = Object.keys(headers).some(
      (key) => key.toLowerCase() === "user-agent"
    );
    if (!hasUserAgentHeader) {
      headers["User-Agent"] = DEFAULT_DOWNLOAD_USER_AGENT;
    }

    const hasAcceptEncoding = Object.keys(headers).some(
      (key) => key.toLowerCase() === "accept-encoding"
    );
    if (!hasAcceptEncoding) {
      headers["Accept-Encoding"] = "identity";
    }

    const hasRange = Object.keys(headers).some(
      (key) => key.toLowerCase() === "range"
    );
    if (!hasRange) {
      headers["Range"] = "bytes=0-0";
    }

    return headers;
  }

  private static async runPreflightAttempt(
    url: string,
    headers: Record<string, string>,
    attempt: number,
    maxAttempts: number
  ): Promise<"done" | "retry"> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "unknown";
      const contentLength = response.headers.get("content-length") ?? "unknown";

      logger.log(
        `[DownloadManager] Preflight response status=${response.status} content-type=${contentType} content-length=${contentLength}`
      );

      await response.body?.cancel().catch(() => undefined);

      if (response.status === 416) {
        logger.log(
          "[DownloadManager] Preflight range was rejected but the link resolved; allowing the download to start"
        );
        return "done";
      }

      if (isRetryableHttpStatus(response.status)) {
        if (attempt < maxAttempts) {
          logger.log(
            `[DownloadManager] Preflight got transient HTTP ${response.status}; retrying (${attempt}/${maxAttempts})`
          );
          return "retry";
        }

        logger.warn(
          `[DownloadManager] Preflight still HTTP ${response.status} after ${maxAttempts} attempts; allowing the download to start and retry`
        );
        return "done";
      }

      if (response.status >= 400) {
        throw new Error(
          `The download link is not available (HTTP ${response.status}).`
        );
      }

      if (
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml")
      ) {
        throw new Error(DownloadError.DownloadLinkReturnedWebPage);
      }

      return "done";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Download URL validation timed out");
      }

      logger.error(
        `[DownloadManager] Preflight request failed: ${describeErrorCause(error)}`
      );

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static async validateJsDownloadResponse(options: {
    url: string;
    headers?: Record<string, string>;
  }) {
    const headers = this.buildPreflightHeaders(options.headers);
    const MAX_PREFLIGHT_ATTEMPTS = 3;
    const PREFLIGHT_RETRY_BASE_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_PREFLIGHT_ATTEMPTS; attempt++) {
      const verdict = await this.runPreflightAttempt(
        options.url,
        headers,
        attempt,
        MAX_PREFLIGHT_ATTEMPTS
      );

      if (verdict === "done") return;

      await new Promise((resolve) =>
        setTimeout(resolve, PREFLIGHT_RETRY_BASE_DELAY_MS * attempt)
      );
    }
  }

  static async startDownload(download: Download) {
    const isHttp = this.isHttpDownloader(download.downloader);
    const downloadId = levelKeys.game(download.shop, download.objectId);

    this.queueHeldForDiskSpace = false;

    // The generation token lets a concurrent cancel/restart for the same id
    // invalidate this in-flight preparation before it spawns a downloader.
    const myGeneration = ++this.startGeneration;

    if (isHttp) {
      logger.log("[DownloadManager] Using JS HTTP downloader");

      const preparedOptions = this.takePreparedJsDownload(download, downloadId);

      // Set preparing state immediately so UI knows download is starting.
      this.downloadingGameId = downloadId;
      this.isPreparingDownload = true;
      this.usingJsDownloader = true;

      try {
        const premiumizeEntries =
          download.downloader === Downloader.Premiumize &&
          download.uri.startsWith("magnet:")
            ? await PremiumizeClient.getDownloadEntries(
                download.uri,
                download.fileIndices
              )
            : null;
        if (
          download.fileIndices?.length &&
          download.downloader === Downloader.Premiumize &&
          !premiumizeEntries?.length
        ) {
          if (
            premiumizeEntries === null &&
            (await PremiumizeClient.startTransferInBackground(download.uri))
          ) {
            throw new Error(DownloadError.PremiumizeTransferStarted);
          }
          throw new Error(
            "The selected Premiumize files are no longer available."
          );
        }
        if (
          download.downloader === Downloader.AllDebrid ||
          download.downloader === Downloader.TorBox ||
          (download.downloader === Downloader.RealDebrid &&
            download.uri.startsWith("magnet:")) ||
          !!premiumizeEntries?.length
        ) {
          let batchState: JsBatchState;
          if (download.downloader === Downloader.TorBox) {
            const manifest = await TorBoxClient.getDownloadFiles(download.uri);
            const selected = selectTorBoxFiles(manifest, download.fileIndices);
            batchState = {
              provider: "torBox",
              downloadId,
              savePath: download.downloadPath,
              entries: selected.map((file) => ({
                fileId: file.id,
                filename: file.path,
                size: file.size,
                isZip: file.isZip,
              })),
              torrentId: manifest.torrentId,
              rootFolderName: manifest.name,
              currentIndex: 0,
              activeIndex: -1,
              completedBytes: 0,
              totalBytes: selected.reduce((sum, file) => sum + file.size, 0),
              lastSpeedUpdate: Date.now(),
              bytesAtLastSpeedUpdate: null,
              batchSpeed: 0,
            };

            // Completed earlier files need no new expiring TorBox link on resume.
            while (batchState.currentIndex < batchState.entries.length - 1) {
              const entry = batchState.entries[batchState.currentIndex];
              this.assertSafeBatchPath(batchState.savePath, entry.filename);
              const filePath = path.join(batchState.savePath, entry.filename);
              try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile() || stat.size !== entry.size) break;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
                throw error;
              }
              batchState.completedBytes += entry.size ?? 0;
              batchState.currentIndex += 1;
            }
          } else if (download.downloader === Downloader.AllDebrid) {
            const entries = await AllDebridClient.getDownloadEntries(
              download.uri,
              download.fileIndices
            );
            if (!entries?.length) {
              throw new Error(DownloadError.NotCachedOnAllDebrid);
            }

            batchState = {
              provider: "allDebrid",
              downloadId,
              savePath: download.downloadPath,
              entries: entries.map((entry) => ({
                ...entry,
                filename: this.sanitizeRelativePath(entry.filename),
              })),
              currentIndex: 0,
              activeIndex: -1,
              completedBytes: 0,
              totalBytes: entries.every((item) => typeof item.size === "number")
                ? entries.reduce((acc, item) => acc + (item.size ?? 0), 0)
                : 0,
              lastSpeedUpdate: Date.now(),
              bytesAtLastSpeedUpdate: null,
              batchSpeed: 0,
            };
          } else {
            const provider =
              download.downloader === Downloader.RealDebrid
                ? "realDebrid"
                : "premiumize";
            let entries = premiumizeEntries;
            if (provider === "realDebrid") {
              const resolved =
                await RealDebridClient.getDownloadEntriesWithTorrent(
                  download.uri,
                  download.fileIndices,
                  download.realDebridTorrentId
                );
              if (
                resolved.torrentId &&
                resolved.torrentId !== download.realDebridTorrentId &&
                this.downloadingGameId === downloadId &&
                this.startGeneration === myGeneration
              ) {
                download.realDebridTorrentId = resolved.torrentId;
                await downloadsSublevel.put(downloadId, download);
              }
              entries = resolved.entries;
            }
            if (!entries?.length) {
              throw new Error(
                provider === "realDebrid"
                  ? DownloadError.NotCachedOnRealDebrid
                  : DownloadError.NotCachedOnPremiumize
              );
            }
            batchState = {
              provider,
              downloadId,
              savePath: download.downloadPath,
              entries: entries.map((entry) => ({
                url: entry.url,
                filename: this.sanitizeRelativePath(entry.path),
                size: entry.size,
                isLocked: "isLocked" in entry && entry.isLocked === true,
                fileIndex: entry.index,
                sourcePath: entry.path,
                chunks:
                  "chunks" in entry && typeof entry.chunks === "number"
                    ? entry.chunks
                    : undefined,
              })),
              sourceUri: download.uri,
              currentIndex: 0,
              activeIndex: -1,
              completedBytes: 0,
              totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
              lastSpeedUpdate: Date.now(),
              bytesAtLastSpeedUpdate: null,
              batchSpeed: 0,
            };
          }

          if (
            this.downloadingGameId !== downloadId ||
            this.startGeneration !== myGeneration
          ) {
            logger.log(
              "[DownloadManager] Download was superseded during preparation; aborting start"
            );
            return;
          }

          this.jsBatch = batchState;
          this.jsDownloader = new JsHttpDownloader();
          this.jsDownloader.setMaxDownloadSpeedBytesPerSecond(
            this.maxDownloadSpeedBytesPerSecond
          );
          this.isPreparingDownload = false;
          void this.runJsBatch();
        } else {
          this.jsBatch = null;
          const options =
            preparedOptions ?? (await this.getJsDownloadOptions(download));

          if (!options) {
            throw new Error("Failed to get download options for JS downloader");
          }

          if (
            this.downloadingGameId !== downloadId ||
            this.startGeneration !== myGeneration
          ) {
            logger.log(
              "[DownloadManager] Download was superseded during preparation; aborting start"
            );
            return;
          }

          this.jsDownloader = new JsHttpDownloader();
          this.jsDownloader.setMaxDownloadSpeedBytesPerSecond(
            this.maxDownloadSpeedBytesPerSecond
          );
          this.isPreparingDownload = false;

          this.logResolvedUrl(options.url);
          this.jsDownloader.startDownload(options).catch((err) => {
            void this.handleRuntimeDownloadError(downloadId, err).catch(
              (error) => {
                logger.error(
                  `[DownloadManager] Failed to handle download error for ${downloadId}`,
                  error
                );
              }
            );
          });
        }
      } catch (err) {
        if (this.startGeneration === myGeneration) {
          this.isPreparingDownload = false;
          this.usingJsDownloader = false;
          this.downloadingGameId = null;
          this.jsBatch = null;
        }

        throw err;
      }
    } else {
      logger.log("[DownloadManager] Using native libtorrent downloader");
      const payload = await this.getDownloadPayload(download);
      const isSelectiveTorrentStart =
        download.downloader === Downloader.Torrent &&
        Array.isArray(download.fileIndices) &&
        download.fileIndices.length > 0;

      const previousDownloadingGameId = this.downloadingGameId;
      const previousIsPreparingDownload = this.isPreparingDownload;
      const previousUsingJsDownloader = this.usingJsDownloader;
      const previousAllDebridBatch = this.jsBatch;

      this.downloadingGameId = downloadId;
      this.isPreparingDownload = true;
      this.usingJsDownloader = false;
      this.jsBatch = null;

      if (payload?.url) {
        this.logResolvedUrl(payload.url);
      }

      try {
        await TorrentService.call("action", payload, {
          timeout: isSelectiveTorrentStart ? 60_000 : 10_000,
        });

        const downloadWasCancelledOrReplaced =
          this.downloadingGameId !== downloadId ||
          this.startGeneration !== myGeneration;

        if (downloadWasCancelledOrReplaced) {
          const wasReplacedBySameGame = this.downloadingGameId === downloadId;

          if (!wasReplacedBySameGame) {
            await TorrentService.call("action", {
              action: "cancel",
              game_id: downloadId,
            }).catch((error) => {
              logger.error(
                "[DownloadManager] Failed to cancel stale torrent download",
                error
              );
            });
          }

          return;
        }

        this.isPreparingDownload = false;
      } catch (error) {
        if (
          this.downloadingGameId === downloadId &&
          this.startGeneration === myGeneration
        ) {
          this.downloadingGameId = previousDownloadingGameId;
          this.isPreparingDownload = previousIsPreparingDownload;
          this.usingJsDownloader = previousUsingJsDownloader;
          this.jsBatch = previousAllDebridBatch;
        }

        throw error;
      }
    }
  }
}
