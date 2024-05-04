import { Game } from "@main/entity";
import { ElectronDownloadManager } from "electron-dl-manager";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { WindowManager } from "../window-manager";
import { Downloader } from "./downloader";
import { GameStatus } from "@globals";

function dropExtension(fileName: string) {
  return fileName.split(".").slice(0, -1).join(".");
}

export class HTTPDownloader {
  private downloadManager: ElectronDownloadManager;
  private downloadId: string | null = null;

  constructor() {
    this.downloadManager = new ElectronDownloadManager();
  }

  async download(url: string, destination: string, gameId: number) {
    const window = WindowManager.mainWindow;

    this.downloadId = await this.downloadManager.download({
      url,
      window: window!,
      callbacks: {
        onDownloadStarted: async (ev) => {
          const updatePayload: QueryDeepPartialEntity<Game> = {
            status: GameStatus.Downloading,
            progress: 0,
            bytesDownloaded: 0,
            fileSize: ev.item.getTotalBytes(),
            rarPath: `${destination}/.rd/${ev.resolvedFilename}`,
            folderName: dropExtension(ev.resolvedFilename),
          };
          const downloadStatus = {
            numPeers: 0,
            numSeeds: 0,
            downloadSpeed: 0,
            timeRemaining: Number.POSITIVE_INFINITY,
          };
          await Downloader.updateGameProgress(
            gameId,
            updatePayload,
            downloadStatus
          );
        },
        onDownloadCompleted: async (ev) => {
          const updatePayload: QueryDeepPartialEntity<Game> = {
            progress: 1,
            decompressionProgress: 0,
            bytesDownloaded: ev.item.getReceivedBytes(),
            status: GameStatus.Decompressing,
          };
          const downloadStatus = {
            numPeers: 1,
            numSeeds: 1,
            downloadSpeed: 0,
            timeRemaining: 0,
          };
          await Downloader.updateGameProgress(
            gameId,
            updatePayload,
            downloadStatus
          );
        },
        onDownloadProgress: async (ev) => {
          const updatePayload: QueryDeepPartialEntity<Game> = {
            progress: ev.percentCompleted / 100,
            bytesDownloaded: ev.item.getReceivedBytes(),
          };
          const downloadStatus = {
            numPeers: 1,
            numSeeds: 1,
            downloadSpeed: ev.downloadRateBytesPerSecond,
            timeRemaining: ev.estimatedTimeRemainingSeconds,
          };
          await Downloader.updateGameProgress(
            gameId,
            updatePayload,
            downloadStatus
          );
        },
      },
      directory: `${destination}/.rd/`,
    });
  }

  pause() {
    if (this.downloadId) {
      this.downloadManager.pauseDownload(this.downloadId);
    }
  }

  cancel() {
    if (this.downloadId) {
      this.downloadManager.cancelDownload(this.downloadId);
    }
  }

  resume() {
    if (this.downloadId) {
      this.downloadManager.resumeDownload(this.downloadId);
    }
  }
}
