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
import path from "path";
import { logger } from "../logger";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { sortBy } from "lodash-es";
import { TorBoxClient } from "./torbox";
import { GameFilesManager } from "../game-files-manager";
import { HydraDebridClient } from "./hydra-debrid";

export class DownloadManager {
  private static downloadingGameId: string | null = null;

  public static async startRPC(
    download?: Download,
    downloadsToSeed?: Download[]
  ) {
    try {
      await PythonRPC.spawn(
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
        this.downloadingGameId = levelKeys.game(
          download.shop,
          download.objectId
        );
      }
    } catch (err) {
      logger.error("Failed to start Python RPC service", err);
      throw err;
    }
  }

  private static async getDownloadStatus() {
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
    } catch (err) {
      return null;
    }
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
        {
          valueEncoding: "json",
        }
      );

      if (WindowManager.mainWindow && download) {
        WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);
        WindowManager.mainWindow.webContents.send(
          "on-download-progress",
          JSON.parse(
            JSON.stringify({
              ...status,
              game,
            })
          )
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
          } else {
            gameFilesManager
              .extractFilesInDirectory(
                path.join(download.downloadPath, download.folderName!)
              )
              .then(() => {
                gameFilesManager.setExtractionComplete();
              });
          }
        }

        const downloads = await downloadsSublevel
          .values()
          .all()
          .then((games) => {
            return sortBy(
              games.filter((game) => game.status === "paused" && game.queued),
              "timestamp",
              "DESC"
            );
          });

        const [nextItemOnQueue] = downloads;

        if (nextItemOnQueue) {
          this.resumeDownload(nextItemOnQueue);
        } else {
          this.downloadingGameId = null;
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
    await PythonRPC.rpc
      .post("/action", {
        action: "pause",
        game_id: downloadKey,
      } as PauseDownloadPayload)
      .catch(() => {});

    if (downloadKey === this.downloadingGameId) {
      WindowManager.mainWindow?.setProgressBar(-1);
      this.downloadingGameId = null;
    }
  }

  static async resumeDownload(download: Download) {
    return this.startDownload(download);
  }

  static async cancelDownload(downloadKey = this.downloadingGameId) {
    await PythonRPC.rpc
      .post("/action", {
        action: "cancel",
        game_id: downloadKey,
      })
      .catch((err) => {
        logger.error("Failed to cancel game download", err);
      });

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

        if (!url) {
          throw new Error(DownloadError.NotCachedOnTorBox);
        }
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
    }
  }

  private static handleRPCStartError(error: unknown): never {
    if (error instanceof Error) {
      if (error.message.includes("Python executable not found")) {
        throw new Error(
          "Python is not installed or not found in PATH. Please install Python 3 and ensure it's accessible from the command line."
        );
      }
      if (error.message.includes("binary not found")) {
        throw new Error(
          "Python RPC binary not found in the application bundle. The application may be corrupted. Please reinstall the application."
        );
      }
      if (error.message.includes("failed to become ready")) {
        throw new Error(
          "Python RPC service failed to start. Please restart the application or check the logs for more information."
        );
      }
    }
    throw error;
  }

  private static async startRPCAndWait(): Promise<void> {
    await this.startRPC();
    const isNowHealthy = await PythonRPC.waitForService();
    if (!isNowHealthy) {
      throw new Error(
        "Python RPC service failed to start or respond. Please check the application logs for more details."
      );
    }
  }

  private static async startRPCWhenNotRunning(): Promise<void> {
    logger.warn("Python RPC service is not running, attempting to start it");
    try {
      await this.startRPCAndWait();
    } catch (error) {
      this.handleRPCStartError(error);
    }
  }

  private static async restartRPC(): Promise<void> {
    logger.warn(
      "Python RPC service process exists but not responding, attempting restart"
    );
    PythonRPC.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await this.startRPCAndWait();
    } catch (error) {
      this.handleRPCStartError(error);
    }
  }

  private static async ensureRPCIsRunning(): Promise<void> {
    const isHealthy = await PythonRPC.checkHealth();

    if (!isHealthy) {
      const isRunning = PythonRPC.isRunning();
      if (isRunning) {
        await this.restartRPC();
      } else {
        await this.startRPCWhenNotRunning();
      }
    }
  }

  static async startDownload(download: Download) {
    await this.ensureRPCIsRunning();

    const payload = await this.getDownloadPayload(download);

    if (!payload) {
      throw new Error("Download payload is not available");
    }

    await PythonRPC.rpc.post("/action", payload);
    this.downloadingGameId = levelKeys.game(download.shop, download.objectId);
  }
}
