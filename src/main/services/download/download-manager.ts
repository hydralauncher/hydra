import { withDownloadActivation } from "./download-activation";
import {
  getRangeDownloadedBytes,
  readRangeState,
  savedRangeBytes,
} from "./range-download-state";
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
  isQueueVerifyCandidate,
  isVerifyingStatus,
} from "./types";
import { calculateETA, getDirSize } from "./helpers";
import { extractDownloadFilename } from "./download-filename";
import { RealDebridClient } from "./real-debrid";
import path from "node:path";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import { logger } from "../logger";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { TorBoxClient } from "./torbox";
import { selectTorBoxFiles } from "./torbox-files";
import { GameFilesManager } from "../game-files-manager";
import { PremiumizeClient } from "./premiumize";
import { AllDebridClient } from "./all-debrid";
import { getDebridRootFolderName, isZipDownloadUrl } from "./debrid-files";
import { getRangeSizeForRequestBudget } from "./parallel-range-download";
import {
  DEFAULT_DOWNLOAD_USER_AGENT,
  JsHttpDownloader,
  type JsHttpDownloaderOptions,
  type JsHttpDownloaderStatus,
} from "./js-http-downloader";
import {
  clampProgress,
  getJsBatchProgress,
  isRetryableHttpStatus,
  sampleJsBatchSpeed,
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
import {
  QUEUE_VERIFY_MAX_ENTRIES,
  QUEUE_VERIFY_TTL_MS,
  clearVerifyAttempt,
  getQueueVerifySig,
  isVerifyAttemptFresh,
  recordVerifyAttempt,
} from "./download-queue-verify";

interface JsDownloadOptions {
  url: string;
  savePath: string;
  filename?: string;
  headers?: Record<string, string>;
  allowParallelRanges?: boolean;
  parallelRangeConnections?: number;
  probeUnboundedRange?: boolean;
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
  generation?: number;
  provider: "allDebrid" | "torBox" | "realDebrid";
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
  private static preparationController: AbortController | null = null;
  private static readonly preparedRealDebridDownloads = new Map<
    string,
    {
      uri: string;
      selection: string;
      resolvedAt: number;
      resolved: Awaited<
        ReturnType<typeof RealDebridClient.getDownloadEntriesWithTorrent>
      >;
    }
  >();
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
  private static readonly queueVerifyAttempts = new Map<
    string,
    { at: number; sig: string }
  >();
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
    const generation = this.startGeneration;
    const downloader = this.jsDownloader;
    const isCurrent = () =>
      this.startGeneration === generation &&
      this.downloadingGameId === downloadId &&
      this.jsDownloader === downloader;

    // Return a "preparing" status while fetching download options
    if (this.isPreparingDownload) {
      try {
        const download = await downloadsSublevel.get(downloadId);
        if (!download || !isCurrent()) return null;

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
      if (!download || !isCurrent()) return null;

      let { progress, bytesDownloaded, fileSize, folderName } = status;
      let downloadSpeed = status.downloadSpeed;
      let files = download.files;
      let batchFilesTotal: number | undefined;
      let batchFilesDownloaded: number | undefined;

      if (this.jsBatch?.downloadId === downloadId) {
        const batch = this.jsBatch;
        const batchDone =
          batch.currentIndex >= batch.entries.length &&
          status.status === "complete";

        batchFilesTotal = batch.entries.length;
        if (batch.provider === "torBox" || batch.provider === "realDebrid") {
          files = batch.entries.map((entry, index) => {
            const previous = download.files?.find(
              (file) => file.index === (entry.fileId ?? entry.fileIndex)
            );
            const completed = index < batch.currentIndex;
            let entryBytes = previous?.bytesDownloaded ?? 0;
            if (completed) entryBytes = entry.size ?? 0;
            else if (index === batch.activeIndex)
              entryBytes = status.bytesDownloaded;
            return {
              index: (entry.fileId ?? entry.fileIndex)!,
              path: entry.filename,
              size: entry.size ?? 0,
              bytesDownloaded: entryBytes,
              completed,
            };
          });
        }

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
        files,
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

      if (!isCurrent()) return null;

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
      const isCheckingFiles = isVerifyingStatus(status);

      const download = await downloadsSublevel.get(downloadId);

      let updatedDownload = download;

      if (!isDownloadingMetadata && !isCheckingFiles) {
        if (!download) return null;

        const effectiveFileSize =
          fileSize > 0
            ? fileSize
            : (download.selectedFilesSize ?? download.fileSize ?? 0);

        updatedDownload = {
          ...download,
          bytesDownloaded,
          fileSize: effectiveFileSize,
          progress,
          folderName,
          status: "active",
        };

        await downloadsSublevel.put(downloadId, updatedDownload);
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
        download: updatedDownload,
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

    if (!status.isCheckingFiles && !status.isDownloadingMetadata) {
      const live = status.download
        ? {
            bytesDownloaded: status.download.bytesDownloaded,
            fileSize: status.download.fileSize,
          }
        : undefined;

      if (await this.haltDownloadIfStorageIsFull(download, game, gameId, live))
        return;
    }

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
    downloadKey: string,
    live?: { bytesDownloaded?: number | null; fileSize?: number | null }
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

    const diskSpace = await getDownloadDiskSpace(download, live);

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

  private static async shouldBypassQueueHoldForVerify(
    download: Download
  ): Promise<boolean> {
    if (!isQueueVerifyCandidate(download)) return false;
    const key = levelKeys.game(download.shop, download.objectId);
    const sig = await getQueueVerifySig(
      path.join(download.downloadPath, download.folderName)
    );
    if (!sig) return false;
    const now = Date.now();
    const prev = this.queueVerifyAttempts.get(key);
    if (isVerifyAttemptFresh(prev, sig, now, QUEUE_VERIFY_TTL_MS)) return false;
    recordVerifyAttempt(
      this.queueVerifyAttempts,
      key,
      sig,
      now,
      QUEUE_VERIFY_MAX_ENTRIES
    );
    return true;
  }

  public static clearQueueVerifyAttempt(
    download: Pick<Download, "shop" | "objectId">
  ): void {
    clearVerifyAttempt(
      this.queueVerifyAttempts,
      levelKeys.game(download.shop, download.objectId)
    );
  }

  private static async processNextQueuedDownload() {
    const failure = await withDownloadActivation(() =>
      this.activateNextQueueItem()
    );
    if (failure)
      await this.handleRuntimeDownloadError(failure.downloadId, failure.error);
  }

  private static async shouldHoldQueuedDownload(nextItemOnQueue: Download) {
    const diskSpace = await getDownloadDiskSpace(nextItemOnQueue);

    if (diskSpace && !diskSpace.hasEnoughSpace) {
      if (await this.shouldBypassQueueHoldForVerify(nextItemOnQueue)) {
        logger.log(
          `[DownloadManager] Allowing queued ${nextItemOnQueue.shop}:${nextItemOnQueue.objectId} to verify existing files before disk check`
        );
      } else {
        if (!this.queueHeldForDiskSpace) {
          logger.warn(
            `[DownloadManager] Keeping the queue on hold: ${nextItemOnQueue.downloadPath} has ${diskSpace.freeBytes} bytes free, ${diskSpace.requiredBytes} needed`
          );
          WindowManager.sendDownloadsUpdated();
        }

        this.queueHeldForDiskSpace = true;
        return true;
      }
    }
    return false;
  }

  private static async activateNextQueueItem(): Promise<
    { downloadId: string; error: unknown } | undefined
  > {
    const downloads = await downloadsSublevel.values().all();
    if (downloads.some((download) => download.status === "active"))
      return undefined;
    const layoutState = await getDownloadLayoutStateRecord();
    const nextItemOnQueue = getNextQueuedDownloadFromLayout(
      downloads,
      layoutState
    );

    if (nextItemOnQueue) {
      if (await this.shouldHoldQueuedDownload(nextItemOnQueue))
        return undefined;

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
        return { downloadId: nextDownloadId, error };
      }
    } else {
      this.queueHeldForDiskSpace = false;
      this.downloadingGameId = null;
      this.usingJsDownloader = false;
      this.jsDownloader = null;
      this.jsBatch = null;
    }
    return undefined;
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
    error: unknown,
    generation = this.startGeneration
  ) {
    const isCurrent = () =>
      this.startGeneration === generation &&
      (!this.downloadingGameId || this.downloadingGameId === downloadId);
    if (!isCurrent()) {
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
      if (!isCurrent()) return;
      if (download) {
        await downloadsSublevel.put(downloadId, {
          ...download,
          status: "error",
          queued: false,
          pinnedToHero: false,
          extracting: false,
        });

        const downloads = await downloadsSublevel.values().all();
        if (!isCurrent()) return;
        const layoutState = await getDownloadLayoutStateRecord();
        if (!isCurrent()) return;
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

    if (!isCurrent()) return;
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
    if (downloadKey === this.downloadingGameId) {
      this.startGeneration += 1;
      this.preparationController?.abort();
      this.preparationController = null;
    }
    const generation = this.startGeneration;
    const isCurrent = () =>
      this.startGeneration === generation &&
      this.downloadingGameId === downloadKey;
    if (isCurrent() && this.usingJsDownloader && this.jsDownloader) {
      logger.log("[DownloadManager] Pausing JS download");
      const downloader = this.jsDownloader;
      downloader.pauseDownload();
      await downloader.waitForIdle();
      if (!isCurrent() || this.jsDownloader !== downloader) return;

      if (downloadKey)
        await this.persistPausedJsProgress(downloadKey, isCurrent);
    } else if (downloadKey) {
      await TorrentService.call("action", {
        action: "pause",
        game_id: downloadKey,
      } as PauseDownloadPayload).catch(() => {});
    }

    if (isCurrent()) {
      WindowManager.mainWindow?.setProgressBar(-1);
      this.downloadingGameId = null;
    }
  }

  private static async persistPausedJsProgress(
    downloadKey: string,
    isCurrent: () => boolean
  ) {
    const status = await this.getDownloadStatusFromJs();
    if (!isCurrent()) return;
    const download = await downloadsSublevel.get(downloadKey);
    if (!isCurrent()) return;
    if (status?.download && download) {
      await downloadsSublevel.put(downloadKey, {
        ...download,
        bytesDownloaded: status.download.bytesDownloaded,
        progress: status.download.progress,
        files: status.download.files,
        folderName: status.download.folderName,
        fileSize: status.download.fileSize,
      });
    }
  }

  static async resumeDownload(download: Download, signal?: AbortSignal) {
    return this.startDownload(download, signal);
  }

  public static requiresPauseConfirmation(downloadKey: string): boolean {
    const batch = this.jsBatch;
    const entry = batch?.entries[batch.currentIndex];
    return (
      this.downloadingGameId === downloadKey &&
      batch?.provider === "torBox" &&
      entry?.isZip === true &&
      this.jsDownloader?.getDownloadStatus()?.resumeCapability === "unsupported"
    );
  }

  public static confirmPauseDownload(
    downloadKey: string,
    confirmed = false
  ): boolean {
    return confirmed || !this.requiresPauseConfirmation(downloadKey);
  }

  public static async prepareRealDebridDownload(
    download: Download,
    signal?: AbortSignal
  ): Promise<boolean> {
    const downloadId = levelKeys.game(download.shop, download.objectId);
    const resolved = await RealDebridClient.getDownloadEntriesWithTorrent(
      download.uri,
      download.fileIndices,
      download.realDebridTorrentId,
      signal
    );
    signal?.throwIfAborted();
    download.realDebridTorrentId =
      resolved.torrentId ?? download.realDebridTorrentId;
    if (!resolved.entries?.length) return false;
    this.preparedRealDebridDownloads.set(downloadId, {
      uri: download.uri,
      selection: JSON.stringify(download.fileIndices),
      resolvedAt: Date.now(),
      resolved,
    });
    return true;
  }

  static async cancelDownload(downloadKey = this.downloadingGameId) {
    if (downloadKey) this.preparedRealDebridDownloads.delete(downloadKey);
    const isActiveDownload = downloadKey === this.downloadingGameId;

    if (isActiveDownload) {
      // Invalidate any in-flight startDownload preparation for this slot so a
      // late-resolving prepare cannot spawn a downloader after cancellation.
      this.startGeneration += 1;
      this.preparationController?.abort();
      this.preparationController = null;
      const generation = this.startGeneration;
      const isCurrent = () =>
        this.startGeneration === generation &&
        this.downloadingGameId === downloadKey;

      if (this.usingJsDownloader && this.jsDownloader) {
        logger.log("[DownloadManager] Cancelling JS download");
        const downloader = this.jsDownloader;
        if (downloader.getDownloadStatus()?.status !== "complete") {
          downloader.pauseDownload();
        }
        await downloader.waitForIdle();
        if (!isCurrent() || this.jsDownloader !== downloader) return;
        downloader.cancelDownload();
        this.jsDownloader = null;
        this.usingJsDownloader = false;
        this.jsBatch = null;
      } else {
        await TorrentService.call("action", {
          action: "cancel",
          game_id: downloadKey,
        }).catch((err) => logger.error("Failed to cancel game download", err));
      }

      if (!isCurrent()) return;
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

  private static async resolveBatchEntryUrl(
    batch: JsBatchState,
    entry: JsBatchEntry
  ): Promise<string | undefined> {
    this.assertSafeBatchPath(batch.savePath, entry.filename);
    const url = entry.url;
    if (batch.provider === "torBox") {
      if (batch.torrentId === undefined || entry.fileId === undefined) {
        throw new Error("The TorBox file selection is incomplete.");
      }
      return TorBoxClient.requestLink(batch.torrentId, entry.fileId);
    }
    if (batch.provider === "realDebrid" && entry.isLocked && url) {
      const unlocked = await RealDebridClient.unlockFileWithDetails(
        url,
        entry.sourcePath ?? entry.filename,
        entry.size ?? 0,
        this.preparationController?.signal
      );
      entry.chunks = unlocked.chunks;
      return unlocked.url;
    }
    if (batch.provider === "allDebrid" && entry.isLocked && url) {
      return AllDebridClient.unlockDownloadLink(url);
    }
    return url;
  }

  private static getBatchDownloadOptions(
    batch: JsBatchState,
    entry: JsBatchEntry,
    url: string
  ): JsHttpDownloaderOptions {
    const torBoxParallel = batch.provider === "torBox" && !entry.isZip;
    const options: JsHttpDownloaderOptions = {
      url,
      savePath: batch.savePath,
      allowParallelRanges:
        batch.provider === "allDebrid"
          ? undefined
          : !entry.isZip &&
            (batch.provider === "torBox" ||
              (batch.provider === "realDebrid" &&
                !isZipDownloadUrl(url, entry.filename))),
      parallelRangeSize: torBoxParallel
        ? getRangeSizeForRequestBudget(
            entry.size ?? 0,
            TORBOX_MAX_PARALLEL_RANGES
          )
        : undefined,
      probeUnboundedRange: batch.provider === "realDebrid",
      parallelRangeConnections:
        batch.provider === "realDebrid"
          ? realDebridConnections(entry.chunks)
          : undefined,
      maxParallelRanges: torBoxParallel
        ? TORBOX_MAX_PARALLEL_RANGES
        : undefined,
      preserveFilename: true,
      resourceId: `${batch.provider}:${batch.sourceUri}#${entry.fileId ?? entry.fileIndex ?? entry.sourcePath ?? entry.filename}`,
      expectedSize:
        (batch.provider === "torBox" || batch.provider === "realDebrid") &&
        !entry.isZip
          ? entry.size
          : undefined,
      requireRangeResume:
        !entry.isZip &&
        (batch.provider === "torBox" || batch.provider === "realDebrid"),
      // Verify a regenerated ZIP's saved prefix before appending new data.
      verifyResumePrefix: Boolean(entry.isZip),
      filename:
        batch.provider === "torBox"
          ? entry.filename
          : this.sanitizeRelativePath(entry.filename),
    };
    options.refreshUrl = this.getBatchUrlRefresh(batch, entry, options);
    return options;
  }

  private static getBatchUrlRefresh(
    batch: JsBatchState,
    entry: JsBatchEntry,
    options: JsHttpDownloaderOptions
  ) {
    const { torrentId } = batch;
    const { fileId } = entry;
    if (
      batch.provider === "torBox" &&
      torrentId !== undefined &&
      fileId !== undefined
    ) {
      return () => TorBoxClient.requestLink(torrentId, fileId);
    }
    if (batch.provider !== "realDebrid" || !entry.url) return undefined;
    return async () => {
      const link = await this.resolveBatchEntryUrl(batch, entry);
      if (!link) throw new Error("The download link is unavailable.");
      options.parallelRangeConnections = realDebridConnections(entry.chunks);
      return link;
    };
  }

  private static async rejectMismatchedBatchEntry(
    batch: JsBatchState,
    entry: JsBatchEntry,
    downloader: JsHttpDownloader,
    status: JsHttpDownloaderStatus
  ): Promise<boolean> {
    const expectedSize = entry.size ?? 0;
    const requiresExactSize =
      batch.provider === "torBox" || batch.provider === "realDebrid";
    const sizeMismatch =
      !entry.isZip &&
      (requiresExactSize
        ? status.bytesDownloaded !== expectedSize
        : expectedSize > 0 && status.bytesDownloaded < expectedSize * 0.95);
    if (!sizeMismatch) return false;

    logger.error(
      `[DownloadManager] ${batch.provider} batch entry ${batch.currentIndex} size mismatch: ` +
        `downloaded=${status.bytesDownloaded} expected=${expectedSize}. ` +
        `The download URL may have returned an error page.`
    );
    const generation = batch.generation ?? this.startGeneration;
    const mismatchDownloadId = batch.downloadId;
    if (!this.isCurrentBatch(batch, downloader, generation)) return true;
    if (!(await this.cleanupBatch(batch, downloader, generation))) return true;
    if (mismatchDownloadId) {
      await this.handleRuntimeDownloadError(
        mismatchDownloadId,
        new Error(
          "A downloaded file returned fewer bytes than expected. Its link may have expired."
        ),
        generation
      );
    }
    return true;
  }

  private static bankCompletedBatchEntry(
    batch: JsBatchState,
    entry: JsBatchEntry,
    status: JsHttpDownloaderStatus
  ): void {
    const expectedSize = entry.size ?? 0;
    if (entry.isZip && expectedSize !== status.bytesDownloaded) {
      batch.totalBytes += status.bytesDownloaded - expectedSize;
    }
    const bankedBytes =
      entry.isZip || !entry.size || entry.size <= 0
        ? status.bytesDownloaded
        : entry.size;
    batch.completedBytes += bankedBytes;
    batch.currentIndex += 1;
  }

  private static async runJsBatchEntry(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    entry: JsBatchEntry
  ): Promise<boolean> {
    const generation = batch.generation ?? this.startGeneration;
    try {
      if (!this.isCurrentBatch(batch, downloader, generation)) return false;
      const url =
        (batch.provider === "torBox" || batch.provider === "realDebrid") &&
        entry.size === 0
          ? "about:blank"
          : await this.resolveBatchEntryUrl(batch, entry);
      if (!this.isCurrentBatch(batch, downloader, generation)) {
        return false;
      }
      if (!url) throw new Error("The download link is unavailable.");

      const options = this.getBatchDownloadOptions(batch, entry, url);
      this.logResolvedUrl(options.url);
      batch.activeIndex = batch.currentIndex;
      await downloader.startDownload(options);

      if (!this.isCurrentBatch(batch, downloader, generation)) {
        return false;
      }
      const status = downloader.getDownloadStatus();
      if (!status || status.status === "paused" || status.status === "error") {
        return false;
      }
      if (
        await this.rejectMismatchedBatchEntry(batch, entry, downloader, status)
      ) {
        return false;
      }
      this.bankCompletedBatchEntry(batch, entry, status);
      return true;
    } catch (err) {
      await this.failJsBatchEntry(batch, downloader, generation, err);
      return false;
    }
  }

  private static async failJsBatchEntry(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    generation: number,
    err: unknown
  ) {
    if (!this.isCurrentBatch(batch, downloader, generation)) return;
    logger.error(`[DownloadManager] ${batch.provider} batch entry error:`, err);
    const failedDownloadId = batch.downloadId;
    const status = await this.getDownloadStatusFromJs();
    if (!this.isCurrentBatch(batch, downloader, generation)) return;
    const download = failedDownloadId
      ? await downloadsSublevel.get(failedDownloadId)
      : null;
    if (!this.isCurrentBatch(batch, downloader, generation)) return;
    if (failedDownloadId && download && status?.download) {
      await downloadsSublevel.put(failedDownloadId, {
        ...download,
        bytesDownloaded: status.download.bytesDownloaded,
        progress: status.download.progress,
        fileSize: status.download.fileSize,
        folderName: status.download.folderName,
      });
    }
    if (!(await this.cleanupBatch(batch, downloader, generation))) return;
    if (failedDownloadId) {
      await this.handleRuntimeDownloadError(failedDownloadId, err, generation);
    }
  }

  private static async runJsBatch() {
    while (this.jsBatch && this.jsDownloader) {
      const batch = this.jsBatch;
      const downloader = this.jsDownloader;
      const entry = batch.entries[batch.currentIndex];
      if (!entry) break;
      if (!(await this.runJsBatchEntry(batch, downloader, entry))) break;
    }
  }

  private static isCurrentBatch(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    generation: number
  ): boolean {
    return (
      this.jsBatch === batch &&
      this.jsDownloader === downloader &&
      this.startGeneration === generation &&
      this.downloadingGameId === batch.downloadId
    );
  }

  private static async cleanupBatch(
    batch: JsBatchState,
    downloader: JsHttpDownloader,
    generation: number
  ): Promise<boolean> {
    // A failed request does not invalidate the bytes already saved. Only an
    // explicit cancellation or confirmed invalid output may remove them.
    if (!this.isCurrentBatch(batch, downloader, generation)) return false;
    await downloader?.waitForIdle();
    if (!this.isCurrentBatch(batch, downloader, generation)) return false;
    downloader?.cancelDownload(false);
    this.usingJsDownloader = false;
    this.jsDownloader = null;
    this.jsBatch = null;
    this.downloadingGameId = null;
    this.isPreparingDownload = false;
    WindowManager.mainWindow?.setProgressBar(-1);
    return true;
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
    let downloadUrl: string | null = null;
    if (first) {
      downloadUrl = first.isLocked
        ? await RealDebridClient.unlockFile(
            first.url,
            first.sourcePath ?? first.path,
            first.size
          )
        : first.url;
    }
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
      probeUnboundedRange: true,
      totalSize: entries?.reduce((sum, entry) => sum + entry.size, 0),
    };
  }

  private static async getPremiumizeDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await PremiumizeClient.getDownloadUrl(download.uri);
    if (!downloadUrl) throw new Error(DownloadError.NotCachedOnPremiumize);
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

  private static async getAllDebridDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadInfo = await AllDebridClient.getDownloadInfo(download.uri);
    if (!downloadInfo?.url) throw new Error(DownloadError.NotCachedOnAllDebrid);
    const filename = resumingFilename
      ? this.sanitizeRelativePath(resumingFilename)
      : downloadInfo.filename
        ? this.sanitizeRelativePath(downloadInfo.filename)
        : this.resolveFilename(undefined, download.uri, downloadInfo.url);
    return this.buildDownloadOptions(
      downloadInfo.url,
      download.downloadPath,
      filename
    );
  }

  private static async getTorBoxDownloadOptions(download: Download) {
    const manifest = await TorBoxClient.getDownloadFiles(download.uri);
    const selected = selectTorBoxFiles(manifest, download.fileIndices);
    download.files = selected.map((file) => {
      this.assertSafeBatchPath(download.downloadPath, file.path);
      const localPath = path.join(download.downloadPath, file.path);
      const bytesDownloaded = getRangeDownloadedBytes(localPath);
      return {
        index: file.id,
        path: file.path,
        size: file.size,
        bytesDownloaded,
        completed: fs.existsSync(localPath) && bytesDownloaded === file.size,
      };
    });
    const firstFile = selected[0];
    const url =
      firstFile.size === 0
        ? "about:blank"
        : await TorBoxClient.requestLink(manifest.torrentId, firstFile.id);
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

  static async validateDownloadUrl(
    download: Download,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted();
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

    signal?.throwIfAborted();
    if (
      !(
        download.downloader === Downloader.TorBox &&
        download.files?.[0]?.size === 0
      )
    ) {
      await this.validateJsDownloadResponse(options, signal);
    }
    signal?.throwIfAborted();

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
    maxAttempts: number,
    signal?: AbortSignal
  ): Promise<"done" | "retry"> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
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
      signal?.throwIfAborted();
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

  private static async validateJsDownloadResponse(
    options: {
      url: string;
      headers?: Record<string, string>;
    },
    signal?: AbortSignal
  ) {
    await this.validatePreflightAttempt(
      options.url,
      this.buildPreflightHeaders(options.headers),
      signal
    );
  }

  private static async validatePreflightAttempt(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    attempt = 1
  ): Promise<void> {
    const maxAttempts = 3;
    const verdict = await this.runPreflightAttempt(
      url,
      headers,
      attempt,
      maxAttempts,
      signal
    );
    if (verdict === "done") return;
    await sleep(1000 * attempt, undefined, { signal });
    if (attempt < maxAttempts)
      await this.validatePreflightAttempt(url, headers, signal, attempt + 1);
  }

  private static isCurrentStart(
    downloadId: string,
    generation: number,
    signal?: AbortSignal
  ) {
    return (
      !signal?.aborted &&
      this.downloadingGameId === downloadId &&
      this.startGeneration === generation
    );
  }

  private static async resolvePreparedRealDebridEntries(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    let entries;
    {
      const prepared = this.preparedRealDebridDownloads.get(downloadId);
      this.preparedRealDebridDownloads.delete(downloadId);
      const resolved =
        prepared?.uri === download.uri &&
        prepared.selection === JSON.stringify(download.fileIndices) &&
        prepared.resolved.torrentId === download.realDebridTorrentId &&
        Date.now() - prepared.resolvedAt < this.PREPARED_JS_DOWNLOAD_TTL_MS
          ? prepared.resolved
          : await RealDebridClient.getDownloadEntriesWithTorrent(
              download.uri,
              download.fileIndices,
              download.realDebridTorrentId,
              signal
            );
      signal.throwIfAborted();
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
    return entries;
  }

  private static async prepareTorBoxBatch(
    download: Download,
    downloadId: string
  ) {
    const manifest = await TorBoxClient.getDownloadFiles(download.uri);
    const selected = selectTorBoxFiles(manifest, download.fileIndices);
    download.files = selected.map((file) => {
      this.assertSafeBatchPath(download.downloadPath, file.path);
      const localPath = path.join(download.downloadPath, file.path);
      const bytesDownloaded = getRangeDownloadedBytes(localPath);
      return {
        index: file.id,
        path: file.path,
        size: file.size,
        bytesDownloaded,
        completed: fs.existsSync(localPath) && bytesDownloaded === file.size,
      };
    });
    const batchState: JsBatchState = {
      provider: "torBox",
      sourceUri: download.uri,
      downloadId,
      savePath: download.downloadPath,
      entries: selected.map((file) => ({
        fileId: file.id,
        filename: file.path,
        size: file.size,
        isZip: manifest.archiveOnly === true,
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

    this.skipCompletedTorBoxEntries(batchState);
    return batchState;
  }

  private static skipCompletedTorBoxEntries(batchState: JsBatchState) {
    // Completed earlier files need no new expiring TorBox link on resume.
    while (batchState.currentIndex < batchState.entries.length - 1) {
      const entry = batchState.entries[batchState.currentIndex];
      this.assertSafeBatchPath(batchState.savePath, entry.filename);
      const filePath = path.join(batchState.savePath, entry.filename);
      try {
        const stat = fs.statSync(filePath);
        const ranges = readRangeState(filePath);
        if (
          !stat.isFile() ||
          stat.size !== entry.size ||
          (ranges && savedRangeBytes(ranges) !== ranges.total)
        )
          break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
      batchState.completedBytes += entry.size ?? 0;
      batchState.currentIndex += 1;
    }
  }

  private static async prepareAllDebridBatch(
    download: Download,
    downloadId: string
  ) {
    const entries = await AllDebridClient.getDownloadEntries(download.uri);
    if (!entries?.length) {
      throw new Error(DownloadError.NotCachedOnAllDebrid);
    }

    const batchState: JsBatchState = {
      provider: "allDebrid",
      sourceUri: download.uri,
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
    return batchState;
  }

  private static async prepareRealDebridBatch(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    const provider = "realDebrid";
    const entries = await this.resolvePreparedRealDebridEntries(
      download,
      downloadId,
      myGeneration,
      signal
    );
    if (!entries?.length) {
      throw new Error(DownloadError.NotCachedOnRealDebrid);
    }
    const batchState: JsBatchState = {
      provider,
      downloadId,
      savePath: download.downloadPath,
      entries: entries.map((entry) => ({
        url: entry.url,
        filename: this.sanitizeRelativePath(entry.path),
        size: entry.size,
        isLocked: "isLocked" in entry && entry.isLocked === true,
        fileIndex: entry.index,
        sourcePath: entry.sourcePath ?? entry.path,
        chunks:
          "chunks" in entry && typeof entry.chunks === "number"
            ? entry.chunks
            : undefined,
      })),
      sourceUri: download.uri,
      rootFolderName: getDebridRootFolderName(
        entries.map((entry) => this.sanitizeRelativePath(entry.path))
      ),
      currentIndex: 0,
      activeIndex: -1,
      completedBytes: 0,
      totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      lastSpeedUpdate: Date.now(),
      bytesAtLastSpeedUpdate: null,
      batchSpeed: 0,
    };
    this.restoreRealDebridBatchProgress(download, batchState);

    return batchState;
  }

  private static restoreRealDebridBatchProgress(
    download: Download,
    batchState: JsBatchState
  ) {
    download.files = batchState.entries.map((entry) => {
      this.assertSafeBatchPath(batchState.savePath, entry.filename);
      const localPath = path.join(batchState.savePath, entry.filename);
      const bytesDownloaded = getRangeDownloadedBytes(localPath);
      return {
        index: entry.fileIndex!,
        path: entry.filename,
        size: entry.size ?? 0,
        bytesDownloaded,
        completed: fs.existsSync(localPath) && bytesDownloaded === entry.size,
      };
    });
    while (batchState.currentIndex < batchState.entries.length - 1) {
      const file = download.files[batchState.currentIndex];
      if (!file.completed) break;
      batchState.completedBytes += file.size;
      batchState.currentIndex++;
    }
  }

  private static async startBatchDownload(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    let batchState: JsBatchState;
    switch (download.downloader) {
      case Downloader.TorBox:
        batchState = await this.prepareTorBoxBatch(download, downloadId);
        break;
      case Downloader.AllDebrid:
        batchState = await this.prepareAllDebridBatch(download, downloadId);
        break;
      default:
        batchState = await this.prepareRealDebridBatch(
          download,
          downloadId,
          myGeneration,
          signal
        );
    }
    if (!this.isCurrentStart(downloadId, myGeneration, signal)) {
      logger.log(
        "[DownloadManager] Download was superseded during preparation; aborting start"
      );
      return;
    }

    if (batchState.provider === "torBox") {
      const record = await downloadsSublevel.get(downloadId);
      if (!record || signal.aborted || this.startGeneration !== myGeneration)
        return;
      await downloadsSublevel.put(downloadId, {
        ...record,
        files: download.files,
      });
      if (signal.aborted || this.startGeneration !== myGeneration) return;
    }
    batchState.generation = myGeneration;
    this.jsBatch = batchState;
    this.jsDownloader = new JsHttpDownloader();
    this.jsDownloader.setMaxDownloadSpeedBytesPerSecond(
      this.maxDownloadSpeedBytesPerSecond
    );
    this.isPreparingDownload = false;
    void this.runJsBatch();
  }

  private static async startSingleJsDownload(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal,
    preparedOptions: JsDownloadOptions | null
  ) {
    this.jsBatch = null;
    const options =
      preparedOptions ?? (await this.getJsDownloadOptions(download));

    if (!options) {
      throw new Error("Failed to get download options for JS downloader");
    }

    if (!this.isCurrentStart(downloadId, myGeneration, signal)) {
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
    this.jsDownloader
      .startDownload({ ...options, resourceId: download.uri })
      .catch((err) =>
        this.reportRuntimeDownloadError(downloadId, err, myGeneration)
      );
  }

  private static async reportRuntimeDownloadError(
    downloadId: string,
    error: unknown,
    generation: number
  ) {
    try {
      await this.handleRuntimeDownloadError(downloadId, error, generation);
    } catch (failure) {
      logger.error(
        `[DownloadManager] Failed to handle download error for ${downloadId}`,
        failure
      );
    }
  }

  private static async startHttpDownload(
    download: Download,
    downloadId: string,
    myGeneration: number,
    signal: AbortSignal
  ) {
    logger.log("[DownloadManager] Using JS HTTP downloader");
    const preparedOptions = this.takePreparedJsDownload(download, downloadId);
    this.downloadingGameId = downloadId;
    this.isPreparingDownload = true;
    this.usingJsDownloader = true;
    try {
      const isBatch =
        download.downloader === Downloader.AllDebrid ||
        download.downloader === Downloader.TorBox ||
        (download.downloader === Downloader.RealDebrid &&
          download.uri.startsWith("magnet:"));
      if (isBatch) {
        await this.startBatchDownload(
          download,
          downloadId,
          myGeneration,
          signal
        );
      } else {
        await this.startSingleJsDownload(
          download,
          downloadId,
          myGeneration,
          signal,
          preparedOptions
        );
      }
    } catch (error) {
      if (this.startGeneration !== myGeneration) return;
      this.isPreparingDownload = false;
      this.usingJsDownloader = false;
      this.downloadingGameId = null;
      this.jsBatch = null;
      throw error;
    }
  }

  private static async cancelStaleTorrent(downloadId: string) {
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
  }

  private static async startTorrentDownload(
    download: Download,
    downloadId: string,
    myGeneration: number
  ) {
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
        await this.cancelStaleTorrent(downloadId);
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

  static async startDownload(download: Download, externalSignal?: AbortSignal) {
    externalSignal?.throwIfAborted();
    const isHttp = this.isHttpDownloader(download.downloader);
    const downloadId = levelKeys.game(download.shop, download.objectId);

    this.queueHeldForDiskSpace = false;

    // The generation token lets a concurrent cancel/restart for the same id
    // invalidate this in-flight preparation before it spawns a downloader.
    const myGeneration = ++this.startGeneration;
    this.preparationController?.abort();
    this.preparationController = new AbortController();
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, this.preparationController.signal])
      : this.preparationController.signal;

    if (isHttp) {
      await this.startHttpDownload(download, downloadId, myGeneration, signal);
    } else {
      await this.startTorrentDownload(download, downloadId, myGeneration);
    }
  }
}
