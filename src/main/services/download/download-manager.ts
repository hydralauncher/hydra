import { Downloader, DownloadError, FILE_EXTENSIONS_TO_EXTRACT } from "@shared";
import { WindowManager } from "../window-manager";
import { publishDownloadCompleteNotification } from "../notifications";
import type { Download, DownloadProgress, UserPreferences } from "@types";
import {
  GofileApi,
  QiwiApi,
  DatanodesApi,
  MediafireApi,
  PixelDrainApi,
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
import { logger } from "../logger";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { sortBy } from "lodash-es";
import { TorBoxClient } from "./torbox";
import { GameFilesManager } from "../game-files-manager";
import { HydraDebridClient } from "./hydra-debrid";
import {
  BuzzheavierApi,
  FuckingFastApi,
  VikingFileApi,
} from "@main/services/hosters";
import { JsHttpDownloader } from "./js-http-downloader";

export class DownloadManager {
  private static downloadingGameId: string | null = null;
  private static jsDownloader: JsHttpDownloader | null = null;
  private static usingJsDownloader = false;

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
    return userPreferences?.useNativeHttpDownloader ?? false;
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
    if (!this.jsDownloader || !this.downloadingGameId) return null;

    const status = this.jsDownloader.getDownloadStatus();
    if (!status) return null;

    const downloadId = this.downloadingGameId;

    try {
      const download = await downloadsSublevel.get(downloadId);
      if (!download) return null;

      const { progress, downloadSpeed, bytesDownloaded, fileSize, folderName } =
        status;

      const updatedDownload = {
        ...download,
        bytesDownloaded,
        fileSize,
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
        timeRemaining: calculateETA(fileSize, bytesDownloaded, downloadSpeed),
        isDownloadingMetadata: false,
        isCheckingFiles: false,
        progress,
        gameId: downloadId,
        download: updatedDownload,
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

    if (status) {
      const { gameId, progress } = status;

      const [download, game] = await Promise.all([
        downloadsSublevel.get(gameId),
        gamesSublevel.get(gameId),
      ]);

      if (!download || !game) return;

      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        { valueEncoding: "json" }
      );

      if (WindowManager.mainWindow && download) {
        WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);
        WindowManager.mainWindow.webContents.send(
          "on-download-progress",
          structuredClone({ ...status, game })
        );
      }

      const shouldExtract = download.automaticallyExtract;

      if (progress === 1 && download) {
        publishDownloadCompleteNotification(game);

        if (
          userPreferences?.seedAfterDownloadComplete &&
          download.downloader === Downloader.Torrent
        ) {
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

        if (shouldExtract) {
          const gameFilesManager = new GameFilesManager(
            game.shop,
            game.objectId
          );

          if (
            FILE_EXTENSIONS_TO_EXTRACT.some((ext) =>
              download.folderName?.endsWith(ext)
            )
          ) {
            gameFilesManager.extractDownloadedFile();
          } else if (download.folderName) {
            gameFilesManager
              .extractFilesInDirectory(
                path.join(download.downloadPath, download.folderName)
              )
              .then(() => gameFilesManager.setExtractionComplete());
          }
        }

        const downloads = await downloadsSublevel
          .values()
          .all()
          .then((games) =>
            sortBy(
              games.filter((game) => game.status === "paused" && game.queued),
              "timestamp",
              "DESC"
            )
          );

        const [nextItemOnQueue] = downloads;

        if (nextItemOnQueue) {
          this.resumeDownload(nextItemOnQueue);
        } else {
          this.downloadingGameId = null;
          this.usingJsDownloader = false;
          this.jsDownloader = null;
        }
      }
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
    if (this.usingJsDownloader && this.jsDownloader) {
      logger.log("[DownloadManager] Cancelling JS download");
      this.jsDownloader.cancelDownload();
      this.jsDownloader = null;
      this.usingJsDownloader = false;
    } else {
      await PythonRPC.rpc
        .post("/action", { action: "cancel", game_id: downloadKey })
        .catch((err) => logger.error("Failed to cancel game download", err));
    }

    if (downloadKey === this.downloadingGameId) {
      WindowManager.mainWindow?.setProgressBar(-1);
      WindowManager.mainWindow?.webContents.send("on-download-progress", null);
      this.downloadingGameId = null;
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
    switch (download.downloader) {
      case Downloader.Gofile: {
        const id = download.uri.split("/").pop();
        const token = await GofileApi.authorize();
        const downloadLink = await GofileApi.getDownloadLink(id!);
        await GofileApi.checkDownloadUrl(downloadLink);
        const filename =
          this.extractFilename(download.uri, downloadLink) ||
          this.extractFilename(downloadLink);

        return {
          url: downloadLink,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
          headers: { Cookie: `accountToken=${token}` },
        };
      }
      case Downloader.PixelDrain: {
        const id = download.uri.split("/").pop();
        const downloadUrl = await PixelDrainApi.getDownloadUrl(id!);
        const filename =
          this.extractFilename(download.uri, downloadUrl) ||
          this.extractFilename(downloadUrl);

        return {
          url: downloadUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.Qiwi: {
        const downloadUrl = await QiwiApi.getDownloadUrl(download.uri);
        const filename =
          this.extractFilename(download.uri, downloadUrl) ||
          this.extractFilename(downloadUrl);

        return {
          url: downloadUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.Datanodes: {
        const downloadUrl = await DatanodesApi.getDownloadUrl(download.uri);
        const filename =
          this.extractFilename(download.uri, downloadUrl) ||
          this.extractFilename(downloadUrl);

        return {
          url: downloadUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.Buzzheavier: {
        logger.log(
          `[DownloadManager] Processing Buzzheavier download for URI: ${download.uri}`
        );
        const directUrl = await BuzzheavierApi.getDirectLink(download.uri);
        const filename =
          this.extractFilename(download.uri, directUrl) ||
          this.extractFilename(directUrl);

        return {
          url: directUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.FuckingFast: {
        logger.log(
          `[DownloadManager] Processing FuckingFast download for URI: ${download.uri}`
        );
        const directUrl = await FuckingFastApi.getDirectLink(download.uri);
        const filename =
          this.extractFilename(download.uri, directUrl) ||
          this.extractFilename(directUrl);

        return {
          url: directUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.Mediafire: {
        const downloadUrl = await MediafireApi.getDownloadUrl(download.uri);
        const filename =
          this.extractFilename(download.uri, downloadUrl) ||
          this.extractFilename(downloadUrl);

        return {
          url: downloadUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.RealDebrid: {
        const downloadUrl = await RealDebridClient.getDownloadUrl(download.uri);
        if (!downloadUrl) throw new Error(DownloadError.NotCachedOnRealDebrid);
        const filename =
          this.extractFilename(download.uri, downloadUrl) ||
          this.extractFilename(downloadUrl);

        return {
          url: downloadUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.TorBox: {
        const { name, url } = await TorBoxClient.getDownloadInfo(download.uri);
        if (!url) return null;

        return {
          url,
          savePath: download.downloadPath,
          filename: name,
        };
      }
      case Downloader.Hydra: {
        const downloadUrl = await HydraDebridClient.getDownloadUrl(
          download.uri
        );
        if (!downloadUrl) throw new Error(DownloadError.NotCachedOnHydra);
        const filename =
          this.extractFilename(download.uri, downloadUrl) ||
          this.extractFilename(downloadUrl);

        return {
          url: downloadUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      case Downloader.VikingFile: {
        logger.log(
          `[DownloadManager] Processing VikingFile download for URI: ${download.uri}`
        );
        const downloadUrl = await VikingFileApi.getDownloadUrl(download.uri);
        const filename =
          this.extractFilename(download.uri, downloadUrl) ||
          this.extractFilename(downloadUrl);

        return {
          url: downloadUrl,
          savePath: download.downloadPath,
          filename: filename ? this.sanitizeFilename(filename) : undefined,
        };
      }
      default:
        return null;
    }
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
      case Downloader.Qiwi: {
        const downloadUrl = await QiwiApi.getDownloadUrl(download.uri);
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
      default:
        return undefined;
    }
  }

  static async startDownload(download: Download) {
    const useJsDownloader = await this.shouldUseJsDownloader();
    const isHttp = this.isHttpDownloader(download.downloader);

    if (useJsDownloader && isHttp) {
      logger.log("[DownloadManager] Using JS HTTP downloader");
      this.downloadingGameId = levelKeys.game(download.shop, download.objectId);

      // Get download options (this includes API calls for Gofile/Mediafire)
      // We still await this to catch errors, but start actual download async
      const options = await this.getJsDownloadOptions(download);

      if (!options) {
        throw new Error("Failed to get download options for JS downloader");
      }

      // Try to get file size from HEAD request before starting download
      // This ensures UI shows file size immediately instead of waiting
      try {
        const headResponse = await fetch(options.url, {
          method: "HEAD",
          headers: options.headers,
        });

        if (headResponse.ok) {
          const contentLength = headResponse.headers.get("content-length");
          if (contentLength) {
            const fileSize = Number.parseInt(contentLength, 10);
            const downloadId = this.downloadingGameId;
            const currentDownload = await downloadsSublevel.get(downloadId);
            if (currentDownload) {
              await downloadsSublevel.put(downloadId, {
                ...currentDownload,
                fileSize,
              });
              logger.log(
                `[DownloadManager] Pre-fetched file size: ${fileSize} bytes`
              );
            }
          }
        }
      } catch {
        // If HEAD request fails, continue anyway - file size will be known from actual download
        logger.log(
          "[DownloadManager] Could not pre-fetch file size, will get from download response"
        );
      }

      // Start download asynchronously (don't await) so UI returns immediately
      this.jsDownloader = new JsHttpDownloader();
      this.usingJsDownloader = true;

      // Start download in background
      this.jsDownloader.startDownload(options).catch((err) => {
        logger.error("[DownloadManager] JS download error:", err);
        this.usingJsDownloader = false;
        this.jsDownloader = null;
      });

      // Poll status immediately after a short delay to get file size from response headers
      // This ensures UI shows file size quickly instead of waiting for watchDownloads loop (2s interval)
      setTimeout(() => {
        this.getDownloadStatusFromJs().catch(() => {
          // Ignore errors - status will be updated by watchDownloads loop
        });
      }, 500);
    } else {
      logger.log("[DownloadManager] Using Python RPC downloader");
      const payload = await this.getDownloadPayload(download);
      await PythonRPC.rpc.post("/action", payload);
      this.downloadingGameId = levelKeys.game(download.shop, download.objectId);
      this.usingJsDownloader = false;
    }
  }
}
