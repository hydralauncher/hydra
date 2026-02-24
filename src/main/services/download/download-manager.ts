import { Downloader, DownloadError, FILE_EXTENSIONS_TO_EXTRACT } from "@shared";
import { WindowManager } from "../window-manager";
import { publishDownloadCompleteNotification } from "../notifications";
import type { Download, DownloadProgress, UserPreferences } from "@types";
import {
  GofileApi,
  DatanodesApi,
  MediafireApi,
  PixelDrainApi,
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
import { orderBy } from "lodash-es";
import { TorBoxClient } from "./torbox";
import { GameFilesManager } from "../game-files-manager";
import { HydraDebridClient } from "./hydra-debrid";
import { PremiumizeClient } from "./premiumize";
import { AllDebridClient } from "./all-debrid";
import { BuzzheavierApi, FuckingFastApi } from "@main/services/hosters";
import { JsHttpDownloader } from "./js-http-downloader";
import { getDirectorySize } from "@main/events/helpers/get-directory-size";

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
        `[DownloadManager] No filename extracted, aria2 will use default`
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

  private static async shouldUseJsDownloader(): Promise<boolean> {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );
    // Default to true - native HTTP downloader is enabled by default (opt-out)
    return userPreferences?.useNativeHttpDownloader ?? true;
  }

  private static isHttpDownloader(downloader: Downloader): boolean {
    return downloader !== Downloader.Torrent;
  }

  public static async startRPC(
    download?: Download,
    downloadsToSeed?: Download[]
  ) {
    PythonRPC.spawn(
      download?.status === "active"
        ? await this.getDownloadPayload(download).catch((err) => {
            logger.error("Error getting download payload", err);
            return undefined;
          })
        : undefined,
      downloadsToSeed?.map((download) => ({
        action: "seed",
        game_id: levelKeys.game(download.shop, download.objectId),
        url: download.uri,
        save_path: download.downloadPath,
      }))
    );

    if (download) {
      this.downloadingGameId = levelKeys.game(download.shop, download.objectId);
    }
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
    const response = await PythonRPC.rpc.get<LibtorrentPayload | null>(
      "/status"
    );
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

        await downloadsSublevel.put(downloadId, {
          ...download,
          bytesDownloaded,
          fileSize,
          progress,
          folderName,
          status: "active",
        });
      }

      return {
        numPeers,
        numSeeds,
        downloadSpeed,
        timeRemaining: calculateETA(fileSize, bytesDownloaded, downloadSpeed),
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

    const isComplete = progress === 1 || download.status === "complete";
    if (isComplete) {
      await this.handleDownloadCompletion(download, game, gameId);
    }
  }

  private static sendProgressUpdate(
    progress: number,
    status: DownloadProgress,
    game: any
  ) {
    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);
      WindowManager.mainWindow.webContents.send(
        "on-download-progress",
        structuredClone({ ...status, game })
      );
    }
  }

  private static async handleDownloadCompletion(
    download: Download,
    game: any,
    gameId: string
  ) {
    publishDownloadCompleteNotification(game);

    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    await this.updateDownloadStatus(
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
      this.handleExtraction(download, game);
    } else {
      const gameFilesManager = new GameFilesManager(game.shop, game.objectId);
      gameFilesManager.searchAndBindExecutable();
    }

    await this.processNextQueuedDownload();
  }

  private static async updateDownloadStatus(
    download: Download,
    gameId: string,
    shouldSeed?: boolean
  ) {
    const shouldExtract = download.automaticallyExtract;

    if (shouldSeed && download.downloader === Downloader.Torrent) {
      await downloadsSublevel.put(gameId, {
        ...download,
        status: "seeding",
        shouldSeed: true,
        queued: false,
        extracting: shouldExtract,
      });
    } else {
      await downloadsSublevel.put(gameId, {
        ...download,
        status: "complete",
        shouldSeed: false,
        queued: false,
        extracting: shouldExtract,
      });
      this.cancelDownload(gameId);
    }
  }

  private static handleExtraction(download: Download, game: any) {
    const gameFilesManager = new GameFilesManager(game.shop, game.objectId);
    const extractionPath = download.folderName
      ? path.join(download.downloadPath, download.folderName)
      : null;

    if (!extractionPath || !fs.existsSync(extractionPath)) {
      gameFilesManager
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
      gameFilesManager.extractDownloadedFile().catch((error) => {
        logger.error(
          "[DownloadManager] Failed to extract downloaded file",
          error
        );
        gameFilesManager.failExtraction(error).catch((failError) => {
          logger.error(
            "[DownloadManager] Failed to persist extraction failure state",
            failError
          );
        });
      });
    } else if (extractionStats.isDirectory()) {
      gameFilesManager
        .extractFilesInDirectory(extractionPath)
        .then((success) => {
          if (success) {
            return gameFilesManager.setExtractionComplete();
          }

          return undefined;
        })
        .catch((error) => {
          logger.error(
            "[DownloadManager] Failed to extract files in directory",
            error
          );
          gameFilesManager.failExtraction(error).catch((failError) => {
            logger.error(
              "[DownloadManager] Failed to persist extraction failure state",
              failError
            );
          });
        });
    } else {
      gameFilesManager
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
    const downloads = await downloadsSublevel
      .values()
      .all()
      .then((games) =>
        orderBy(
          games.filter((game) => game.status === "paused" && game.queued),
          ["timestamp"],
          ["desc"]
        )
      );

    const [nextItemOnQueue] = downloads;

    if (nextItemOnQueue) {
      this.resumeDownload(nextItemOnQueue);
    } else {
      this.downloadingGameId = null;
      this.usingJsDownloader = false;
      this.jsDownloader = null;
      this.allDebridBatch = null;
    }
  }

  public static async getSeedStatus() {
    const seedStatus = await PythonRPC.rpc
      .get<LibtorrentPayload[] | []>("/seed-status")
      .then((res) => res.data);

    if (!seedStatus.length) return;

    logger.log(seedStatus);

    seedStatus.forEach(async (status) => {
      const download = await downloadsSublevel.get(status.gameId);

      if (!download) return;

      const totalSize = await getDirSize(
        path.join(download.downloadPath, status.folderName)
      );

      if (totalSize < status.fileSize) {
        await this.cancelDownload(status.gameId);

        await downloadsSublevel.put(status.gameId, {
          ...download,
          status: "paused",
          shouldSeed: false,
          progress: totalSize / status.fileSize,
        });

        WindowManager.mainWindow?.webContents.send("on-hard-delete");
      }
    });

    WindowManager.mainWindow?.webContents.send("on-seeding-status", seedStatus);
  }

  static async pauseDownload(downloadKey = this.downloadingGameId) {
    if (this.usingJsDownloader && this.jsDownloader) {
      logger.log("[DownloadManager] Pausing JS download");
      this.jsDownloader.pauseDownload();
    } else {
      await PythonRPC.rpc
        .post("/action", {
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
      } else if (!this.isPreparingDownload) {
        await PythonRPC.rpc
          .post("/action", { action: "cancel", game_id: downloadKey })
          .catch((err) => logger.error("Failed to cancel game download", err));
      }

      WindowManager.mainWindow?.setProgressBar(-1);
      WindowManager.mainWindow?.webContents.send("on-download-progress", null);
      this.downloadingGameId = null;
      this.isPreparingDownload = false;
      this.usingJsDownloader = false;
      this.allDebridBatch = null;
    }
  }

  static async resumeSeeding(download: Download) {
    await PythonRPC.rpc.post("/action", {
      action: "resume_seeding",
      game_id: levelKeys.game(download.shop, download.objectId),
      url: download.uri,
      save_path: download.downloadPath,
    });
  }

  static async pauseSeeding(downloadKey: string) {
    await PythonRPC.rpc.post("/action", {
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
      case Downloader.Buzzheavier:
        return this.getBuzzheavierDownloadOptions(download, resumingFilename);
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
        return this.getHydraDownloadOptions(download, resumingFilename);
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
    const id = download.uri.split("/").pop();
    const token = await GofileApi.authorize();
    const downloadLink = await GofileApi.getDownloadLink(id!);
    await GofileApi.checkDownloadUrl(downloadLink);
    const filename = this.resolveFilename(
      resumingFilename,
      download.uri,
      downloadLink
    );
    return this.buildDownloadOptions(
      downloadLink,
      download.downloadPath,
      filename,
      { Cookie: `accountToken=${token}` }
    );
  }

  private static async getPixelDrainDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const id = download.uri.split("/").pop();
    const downloadUrl = await PixelDrainApi.getDownloadUrl(id!);
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

  private static async getBuzzheavierDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    logger.log(
      `[DownloadManager] Processing Buzzheavier download for URI: ${download.uri}`
    );
    const directUrl = await BuzzheavierApi.getDirectLink(download.uri);
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

  private static async getHydraDownloadOptions(
    download: Download,
    resumingFilename?: string
  ) {
    const downloadUrl = await HydraDebridClient.getDownloadUrl(download.uri);
    if (!downloadUrl) throw new Error(DownloadError.NotCachedOnHydra);
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
        const id = download.uri.split("/").pop();
        const token = await GofileApi.authorize();
        const downloadLink = await GofileApi.getDownloadLink(id!);
        await GofileApi.checkDownloadUrl(downloadLink);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadLink,
          save_path: download.downloadPath,
          header: `Cookie: accountToken=${token}`,
          allow_multiple_connections: true,
          connections_limit: 8,
        };
      }
      case Downloader.PixelDrain: {
        const id = download.uri.split("/").pop();
        const downloadUrl = await PixelDrainApi.getDownloadUrl(id!);

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
      case Downloader.Buzzheavier: {
        logger.log(
          `[DownloadManager] Processing Buzzheavier download for URI: ${download.uri}`
        );
        try {
          const directUrl = await BuzzheavierApi.getDirectLink(download.uri);
          logger.log(`[DownloadManager] Buzzheavier direct URL obtained`);
          return this.createDownloadPayload(
            directUrl,
            download.uri,
            downloadId,
            download.downloadPath
          );
        } catch (error) {
          logger.error(
            `[DownloadManager] Error processing Buzzheavier download:`,
            error
          );
          throw error;
        }
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
      case Downloader.Torrent:
        return {
          action: "start",
          game_id: downloadId,
          url: download.uri,
          save_path: download.downloadPath,
        };
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
        const downloadUrl = await HydraDebridClient.getDownloadUrl(
          download.uri
        );
        if (!downloadUrl) throw new Error(DownloadError.NotCachedOnHydra);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath,
          allow_multiple_connections: true,
        };
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
    const useJsDownloader = await this.shouldUseJsDownloader();
    const isHttp = this.isHttpDownloader(download.downloader);

    if (useJsDownloader && isHttp) {
      const options = await this.getJsDownloadOptions(download);
      if (!options) {
        throw new Error("Failed to validate download URL");
      }
    } else if (isHttp) {
      await this.getDownloadPayload(download);
    }
  }

  static async startDownload(download: Download) {
    const useJsDownloader = await this.shouldUseJsDownloader();
    const isHttp = this.isHttpDownloader(download.downloader);
    const downloadId = levelKeys.game(download.shop, download.objectId);

    if (useJsDownloader && isHttp) {
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
          this.isPreparingDownload = false;

          this.jsDownloader.startDownload(options).catch((err) => {
            logger.error("[DownloadManager] JS download error:", err);
            this.usingJsDownloader = false;
            this.jsDownloader = null;
            this.allDebridBatch = null;
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
      await PythonRPC.rpc.post("/action", payload);
      this.downloadingGameId = downloadId;
      this.usingJsDownloader = false;
      this.allDebridBatch = null;
    }
  }
}
