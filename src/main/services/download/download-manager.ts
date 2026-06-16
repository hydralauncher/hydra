import { Downloader, DownloadError, FILE_EXTENSIONS_TO_EXTRACT } from "@shared";
import { WindowManager } from "../window-manager";
import { publishDownloadCompleteNotification } from "../notifications";
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
import { PythonRPC } from "../python-rpc";
import {
  LibtorrentPayload,
  LibtorrentStatus,
  PauseDownloadPayload,
} from "./types";
import { calculateETA, getDirSize } from "./helpers";
import { RealDebridClient } from "./real-debrid";
import path from "node:path";
import fs from "node:fs";
import { logger } from "../logger";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { TorBoxClient } from "./torbox";
import { GameFilesManager } from "../game-files-manager";
import { PremiumizeClient } from "./premiumize";
import { AllDebridClient } from "./all-debrid";
import {
  DEFAULT_DOWNLOAD_USER_AGENT,
  JsHttpDownloader,
} from "./js-http-downloader";
import { getDirectorySize } from "@main/events/helpers/get-directory-size";
import {
  getDownloadLayoutStateRecord,
  getNextQueuedDownloadFromLayout,
  setDownloadLayoutQueues,
} from "../download-layout-state";
import { shouldFinalizeDownload } from "./download-completion";

interface AllDebridBatchEntry {
  url: string;
  filename: string;
  size?: number;
  isLocked?: boolean;
}

interface AllDebridBatchState {
  downloadId: string;
  savePath: string;
  entries: AllDebridBatchEntry[];
  currentIndex: number;
  completedBytes: number;
  totalBytes: number;
  lastSpeedUpdate: number;
  bytesAtLastSpeedUpdate: number;
  batchSpeed: number;
}

export class DownloadManager {
  private static downloadingGameId: string | null = null;
  private static jsDownloader: JsHttpDownloader | null = null;
  private static usingJsDownloader = false;
  private static isPreparingDownload = false;
  private static allDebridBatch: AllDebridBatchState | null = null;
  private static maxDownloadSpeedBytesPerSecond: number | null = null;

  public static hasActiveDownload() {
    return this.downloadingGameId !== null;
  }

  private static extractFilename(
    url: string,
    originalUrl?: string
  ): string | undefined {
    if (originalUrl?.includes("#")) {
      const hashPart = originalUrl.split("#")[1];
      if (hashPart && !hashPart.startsWith("http") && hashPart.includes(".")) {
        return hashPart;
      }
    }

    if (url.includes("#")) {
      const hashPart = url.split("#")[1];
      if (hashPart && !hashPart.startsWith("http") && hashPart.includes(".")) {
        return hashPart;
      }
    }

    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const pathParts = pathname.split("/");
      const filename = pathParts.at(-1);

      if (filename?.includes(".") && filename.length > 0) {
        return decodeURIComponent(filename);
      }
    } catch {
      // Invalid URL
    }

    return undefined;
  }

  private static sanitizeFilename(filename: string): string {
    return filename.replaceAll(/[<>:"/\\|?*]/g, "_");
  }

  private static sanitizeRelativePath(pathValue: string): string {
    return pathValue
      .split(/[\\/]+/)
      .map((segment) => this.sanitizeFilename(segment))
      .filter(Boolean)
      .join("/");
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

    await PythonRPC.rpc
      .call("action", {
        action: "set_download_limit",
        max_download_speed_bytes_per_second: normalizedLimit,
      })
      .catch((error) => {
        logger.error(
          "[DownloadManager] Failed to update RPC download speed limit:",
          error
        );
      });
  }

  public static async startRPC(
    download?: Download,
    downloadsToSeed?: Download[]
  ) {
    await PythonRPC.spawn();

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

      if (
        this.allDebridBatch &&
        this.allDebridBatch.downloadId === downloadId
      ) {
        const batch = this.allDebridBatch;
        const batchDone =
          batch.currentIndex >= batch.entries.length &&
          status.status === "complete";

        batchFilesTotal = batch.entries.length;

        if (batchDone) {
          this.allDebridBatch = null;
          progress = 1;
          bytesDownloaded = batch.completedBytes;
          fileSize = batch.totalBytes;
          batchFilesDownloaded = batchFilesTotal;
        } else {
          if (status.status === "complete") {
            status.status = "active";
          }

          const currentBytes =
            status.status === "active" ? status.bytesDownloaded : 0;

          progress = this.calculateAllDebridBatchProgress(
            batch,
            status.progress,
            currentBytes,
            status.fileSize
          );
          bytesDownloaded = batch.completedBytes + currentBytes;
          fileSize = batch.totalBytes || fileSize;
          folderName =
            batch.entries[batch.currentIndex]?.filename ?? folderName;
          batchFilesDownloaded = batch.currentIndex;

          // Compute batch-level speed so small files don't reset the reading
          const now = Date.now();
          const elapsed = (now - batch.lastSpeedUpdate) / 1000;
          if (elapsed >= 1) {
            const bytesDelta = bytesDownloaded - batch.bytesAtLastSpeedUpdate;
            batch.batchSpeed = Math.max(0, bytesDelta / elapsed);
            batch.lastSpeedUpdate = now;
            batch.bytesAtLastSpeedUpdate = bytesDownloaded;
          }
          downloadSpeed = batch.batchSpeed;
        }
      }

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
      response = await PythonRPC.rpc.call<LibtorrentPayload | null>("status");
    } catch (error) {
      logger.error("[DownloadManager] RPC status poll failed", error);
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

  public static async watchDownloads() {
    const status = await this.getDownloadStatus();
    if (!status) return;

    const { gameId, progress } = status;
    const [download, game] = await Promise.all([
      downloadsSublevel.get(gameId),
      gamesSublevel.get(gameId),
    ]);

    if (!download || !game) return;

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
        .failExtraction(new Error("No downloaded archive was found to extract"))
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
      this.downloadingGameId = null;
      this.usingJsDownloader = false;
      this.jsDownloader = null;
      this.allDebridBatch = null;
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
    this.allDebridBatch = null;
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
      seedStatus = await PythonRPC.rpc
        .call<LibtorrentPayload[] | []>("seed_status")
        .then((res) => res.data);
    } catch (error) {
      logger.error("[DownloadManager] RPC seed status poll failed", error);
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
      this.jsDownloader.pauseDownload();
    } else if (downloadKey) {
      await PythonRPC.rpc
        .call("action", {
          action: "pause",
          game_id: downloadKey,
        } as PauseDownloadPayload)
        .catch(() => {});
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
      if (this.usingJsDownloader && this.jsDownloader) {
        logger.log("[DownloadManager] Cancelling JS download");
        this.jsDownloader.cancelDownload();
        this.jsDownloader = null;
        this.usingJsDownloader = false;
        this.allDebridBatch = null;
      } else {
        await PythonRPC.rpc
          .call("action", { action: "cancel", game_id: downloadKey })
          .catch((err) => logger.error("Failed to cancel game download", err));
      }

      WindowManager.mainWindow?.setProgressBar(-1);
      WindowManager.sendToAppWindows("on-download-progress", null);
      this.downloadingGameId = null;
      this.isPreparingDownload = false;
      this.usingJsDownloader = false;
      this.allDebridBatch = null;
    } else if (downloadKey) {
      await PythonRPC.rpc
        .call("action", { action: "cancel", game_id: downloadKey })
        .catch((err) => logger.error("Failed to cancel game download", err));
    }
  }

  static async resumeSeeding(download: Download) {
    await PythonRPC.rpc.call("action", {
      action: "resume_seeding",
      game_id: levelKeys.game(download.shop, download.objectId),
      url: download.uri,
      save_path: download.downloadPath,
    });
  }

  static async pauseSeeding(downloadKey: string) {
    await PythonRPC.rpc.call("action", {
      action: "pause_seeding",
      game_id: downloadKey,
    });
  }

  private static async getJsDownloadOptions(download: Download): Promise<{
    url: string;
    savePath: string;
    filename?: string;
    headers?: Record<string, string>;
  } | null> {
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
        return this.getTorBoxDownloadOptions(download, resumingFilename);
      case Downloader.Hydra:
        throw new Error(DownloadError.NotCachedOnHydra);
      case Downloader.VikingFile:
        return this.getVikingFileDownloadOptions(download, resumingFilename);
      case Downloader.Rootz:
        return this.getRootzDownloadOptions(download, resumingFilename);
      default:
        return null;
    }
  }

  private static calculateAllDebridBatchProgress(
    batch: AllDebridBatchState,
    currentFileProgress: number,
    currentBytesDownloaded: number,
    currentFileSize: number
  ) {
    if (batch.totalBytes > 0) {
      const effectiveCurrentBytes =
        currentFileSize > 0
          ? currentFileSize * Math.max(0, Math.min(currentFileProgress, 1))
          : currentBytesDownloaded;
      return Math.min(
        (batch.completedBytes + effectiveCurrentBytes) / batch.totalBytes,
        1
      );
    }

    const totalEntries = Math.max(batch.entries.length, 1);
    return Math.min(
      (batch.currentIndex + Math.max(0, Math.min(currentFileProgress, 1))) /
        totalEntries,
      1
    );
  }

  private static async runAllDebridBatch() {
    while (this.allDebridBatch && this.jsDownloader) {
      const batch = this.allDebridBatch;
      const downloader = this.jsDownloader;
      const entry = batch.entries[batch.currentIndex];
      if (!entry) break;

      try {
        let resolvedUrl = entry.url;
        if (entry.isLocked) {
          resolvedUrl = await AllDebridClient.unlockDownloadLink(entry.url);
        }

        if (!this.allDebridBatch || !this.jsDownloader) break;

        const options = {
          url: resolvedUrl,
          savePath: batch.savePath,
          filename: this.sanitizeRelativePath(entry.filename),
        };

        this.logResolvedUrl(options.url);
        await downloader.startDownload(options);

        if (!this.allDebridBatch || !this.jsDownloader) break;

        const dlStatus = downloader.getDownloadStatus();
        if (
          !dlStatus ||
          dlStatus.status === "paused" ||
          dlStatus.status === "error"
        ) {
          break;
        }

        const expectedSize = entry.size ?? 0;
        if (
          expectedSize > 0 &&
          dlStatus.bytesDownloaded < expectedSize * 0.95
        ) {
          logger.error(
            `[DownloadManager] AllDebrid batch entry ${batch.currentIndex} size mismatch: ` +
              `downloaded=${dlStatus.bytesDownloaded} expected=${expectedSize}. ` +
              `The download URL may have returned an error page.`
          );
          this.cleanupBatch();
          return;
        }

        batch.completedBytes += Math.max(
          entry.size ?? 0,
          dlStatus.bytesDownloaded
        );
        batch.currentIndex += 1;
      } catch (err) {
        logger.error("[DownloadManager] AllDebrid batch entry error:", err);
        this.cleanupBatch();
        return;
      }
    }
  }

  private static cleanupBatch() {
    this.usingJsDownloader = false;
    this.jsDownloader?.cancelDownload();
    this.jsDownloader = null;
    this.allDebridBatch = null;
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
    const alternateCdnDownloadLink =
      await GofileApi.getAlternateCdnDownloadLinkIfAvailable(id);

    if (alternateCdnDownloadLink) {
      logger.log(
        `[DownloadManager] GoFile download ${id} will use alternate CDN`
      );
      return { url: alternateCdnDownloadLink };
    }

    logger.log(
      `[DownloadManager] GoFile download ${id} will use official GoFile fallback`
    );

    const downloadLink = await GofileApi.getDownloadLink(id, password);
    await GofileApi.checkDownloadUrl(downloadLink);
    const token = await GofileApi.authorize();

    return {
      url: downloadLink,
      headers: { Cookie: `accountToken=${token}` },
    };
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
    const downloadUrl = await RealDebridClient.getDownloadUrl(download.uri);
    if (!downloadUrl) throw new Error(DownloadError.NotCachedOnRealDebrid);
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

  private static async getTorBoxDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const { name, url } = await TorBoxClient.getDownloadInfo(download.uri);
    if (!url) return null;
    return this.buildDownloadOptions(
      url,
      download.downloadPath,
      resumingFilename || name
    );
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
      case Downloader.TorBox: {
        const { name, url } = await TorBoxClient.getDownloadInfo(download.uri);
        if (!url) return;
        return {
          action: "start",
          game_id: downloadId,
          url,
          save_path: download.downloadPath,
          out: name,
          allow_multiple_connections: true,
        };
      }
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
    const isHttp = this.isHttpDownloader(download.downloader);

    if (isHttp) {
      const options = await this.getJsDownloadOptions(download);
      if (!options) {
        throw new Error("Failed to validate download URL");
      }

      await this.validateJsDownloadResponse(options);
    }
  }

  private static async validateJsDownloadResponse(options: {
    url: string;
    headers?: Record<string, string>;
  }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const headers: Record<string, string> = { ...options.headers };
    const hasUserAgentHeader = Object.keys(headers).some(
      (key) => key.toLowerCase() === "user-agent"
    );

    if (!hasUserAgentHeader) {
      headers["User-Agent"] = DEFAULT_DOWNLOAD_USER_AGENT;
    }

    try {
      const response = await fetch(options.url, {
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

      if (response.status >= 400) {
        throw new Error(
          `The download link is not available (HTTP ${response.status}).`
        );
      }

      if (
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml")
      ) {
        throw new Error(
          "The download link returned a web page instead of a file. It may have expired or be invalid."
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Download URL validation timed out");
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static async startDownload(download: Download) {
    const isHttp = this.isHttpDownloader(download.downloader);
    const downloadId = levelKeys.game(download.shop, download.objectId);

    if (isHttp) {
      logger.log("[DownloadManager] Using JS HTTP downloader");

      // Set preparing state immediately so UI knows download is starting
      this.downloadingGameId = downloadId;
      this.isPreparingDownload = true;
      this.usingJsDownloader = true;

      try {
        if (download.downloader === Downloader.AllDebrid) {
          const entries = await AllDebridClient.getDownloadEntries(
            download.uri
          );
          if (!entries?.length) {
            this.isPreparingDownload = false;
            this.usingJsDownloader = false;
            this.downloadingGameId = null;
            throw new Error(DownloadError.NotCachedOnAllDebrid);
          }

          this.allDebridBatch = {
            downloadId,
            savePath: download.downloadPath,
            entries: entries.map((entry) => ({
              ...entry,
              filename: this.sanitizeRelativePath(entry.filename),
            })),
            currentIndex: 0,
            completedBytes: 0,
            totalBytes: entries.every((item) => typeof item.size === "number")
              ? entries.reduce((acc, item) => acc + (item.size ?? 0), 0)
              : 0,
            lastSpeedUpdate: Date.now(),
            bytesAtLastSpeedUpdate: 0,
            batchSpeed: 0,
          };

          this.jsDownloader = new JsHttpDownloader();
          this.jsDownloader.setMaxDownloadSpeedBytesPerSecond(
            this.maxDownloadSpeedBytesPerSecond
          );
          this.isPreparingDownload = false;
          void this.runAllDebridBatch();
        } else {
          this.allDebridBatch = null;
          const options = await this.getJsDownloadOptions(download);

          if (!options) {
            this.isPreparingDownload = false;
            this.usingJsDownloader = false;
            this.downloadingGameId = null;
            throw new Error("Failed to get download options for JS downloader");
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
        this.isPreparingDownload = false;
        this.usingJsDownloader = false;
        this.downloadingGameId = null;
        this.allDebridBatch = null;
        throw err;
      }
    } else {
      logger.log("[DownloadManager] Using Python RPC downloader");
      const payload = await this.getDownloadPayload(download);
      const isSelectiveTorrentStart =
        download.downloader === Downloader.Torrent &&
        Array.isArray(download.fileIndices) &&
        download.fileIndices.length > 0;

      const previousDownloadingGameId = this.downloadingGameId;
      const previousIsPreparingDownload = this.isPreparingDownload;
      const previousUsingJsDownloader = this.usingJsDownloader;
      const previousAllDebridBatch = this.allDebridBatch;

      this.downloadingGameId = downloadId;
      this.isPreparingDownload = true;
      this.usingJsDownloader = false;
      this.allDebridBatch = null;

      if (payload?.url) {
        this.logResolvedUrl(payload.url);
      }

      try {
        await PythonRPC.rpc.call("action", payload, {
          timeout: isSelectiveTorrentStart ? 60_000 : 10_000,
        });

        const downloadWasCancelledOrReplaced =
          this.downloadingGameId !== downloadId;

        if (downloadWasCancelledOrReplaced) {
          await PythonRPC.rpc
            .call("action", { action: "cancel", game_id: downloadId })
            .catch((error) => {
              logger.error(
                "[DownloadManager] Failed to cancel stale torrent download",
                error
              );
            });
          return;
        }

        this.isPreparingDownload = false;
      } catch (error) {
        if (this.downloadingGameId === downloadId) {
          this.downloadingGameId = previousDownloadingGameId;
          this.isPreparingDownload = previousIsPreparingDownload;
          this.usingJsDownloader = previousUsingJsDownloader;
          this.allDebridBatch = previousAllDebridBatch;
        }

        throw error;
      }
    }
  }
}
