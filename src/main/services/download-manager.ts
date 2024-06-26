import WebTorrent, { Torrent } from "webtorrent";
import path from "node:path";
import { downloadQueueRepository, gameRepository } from "@main/repository";
import { WindowManager } from "./window-manager";
import { RealDebridClient } from "./real-debrid";
import { Downloader } from "@shared";
import { DownloadProgress } from "@types";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { Game } from "@main/entity";
import { sleep } from "@main/helpers";
import { logger } from "./logger";
import { publishDownloadCompleteNotification } from "./notifications";

export class DownloadManager {
  private static downloads = new Map<number, Torrent>();
  private static client = new WebTorrent();
  private static game: Game | null = null;
  private static realDebridTorrentId: string | null = null;
  private static statusUpdateInterval: NodeJS.Timeout | null = null;

  private static getETA(
    totalLength: number,
    completedLength: number,
    speed: number
  ) {
    const remainingBytes = totalLength - completedLength;
    if (remainingBytes >= 0 && speed > 0) {
      return (remainingBytes / speed) * 1000;
    }
    return -1;
  }

  private static getFolderName(torrent: Torrent) {
    return torrent.name;
  }

  private static async getRealDebridDownloadUrl() {
    try {
      if (this.realDebridTorrentId) {
        const torrentInfo = await RealDebridClient.getTorrentInfo(
          this.realDebridTorrentId
        );
        const { status, links } = torrentInfo;

        if (status === "waiting_files_selection") {
          await RealDebridClient.selectAllFiles(this.realDebridTorrentId);
          return null;
        }

        if (status === "downloaded") {
          const [link] = links;
          const { download } = await RealDebridClient.unrestrictLink(link);
          return decodeURIComponent(download);
        }

        if (WindowManager.mainWindow) {
          const progress = torrentInfo.progress / 100;
          const totalDownloaded = progress * torrentInfo.bytes;

          WindowManager.mainWindow.setProgressBar(
            progress === 1 ? -1 : progress
          );

          const payload = {
            numPeers: 0,
            numSeeds: torrentInfo.seeders,
            downloadSpeed: torrentInfo.speed,
            timeRemaining: this.getETA(
              torrentInfo.bytes,
              totalDownloaded,
              torrentInfo.speed
            ),
            isDownloadingMetadata: status === "magnet_conversion",
            game: {
              ...this.game,
              bytesDownloaded: progress * torrentInfo.bytes,
              progress,
            },
          } as DownloadProgress;

          WindowManager.mainWindow.webContents.send(
            "on-download-progress",
            JSON.parse(JSON.stringify(payload))
          );
        }
      }
    } catch (error) {
      logger.error("Error getting RealDebrid download URL:", error);
    }
    return null;
  }

  private static async updateDownloadStatus() {
    if (!this.game) return;

    if (!this.downloads.has(this.game.id) && this.realDebridTorrentId) {
      const downloadUrl = await this.getRealDebridDownloadUrl();
      if (downloadUrl) {
        this.startDownloadFromUrl(downloadUrl);
        this.realDebridTorrentId = null;
      }
    }

    if (!this.downloads.has(this.game.id)) return;

    const torrent = this.downloads.get(this.game.id)!;
    const progress = torrent.progress;
    const status = torrent.done ? "complete" : "downloading";

    const update: QueryDeepPartialEntity<Game> = {
      bytesDownloaded: torrent.downloaded,
      fileSize: torrent.length,
      status: status,
      progress: progress,
    };

    await gameRepository.update(
      { id: this.game.id },
      { ...update, status, folderName: this.getFolderName(torrent) }
    );

    const game = await gameRepository.findOne({
      where: { id: this.game.id, isDeleted: false },
    });

    if (WindowManager.mainWindow && game) {
      WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);

      const payload = {
        numPeers: torrent.numPeers,
        numSeeds: torrent.numPeers, // WebTorrent doesn't differentiate between seeds and peers
        downloadSpeed: torrent.downloadSpeed,
        timeRemaining: this.getETA(
          torrent.length,
          torrent.downloaded,
          torrent.downloadSpeed
        ),
        isDownloadingMetadata: false,
        game,
      } as DownloadProgress;

      WindowManager.mainWindow.webContents.send(
        "on-download-progress",
        JSON.parse(JSON.stringify(payload))
      );
    }

    if (progress === 1 && this.game) {
      publishDownloadCompleteNotification(this.game);
      await downloadQueueRepository.delete({ game: this.game });
      this.clearCurrentDownload();

      const [nextQueueItem] = await downloadQueueRepository.find({
        order: { id: "DESC" },
        relations: { game: true },
      });

      if (nextQueueItem) {
        this.resumeDownload(nextQueueItem.game);
      }
    }
  }

  private static clearCurrentDownload() {
    if (this.game) {
      this.downloads.delete(this.game.id);
      this.game = null;
      this.realDebridTorrentId = null;
    }
  }

  static async cancelDownload(gameId: number) {
    try {
      const torrent = this.downloads.get(gameId);
      if (torrent) {
        torrent.destroy();
        this.downloads.delete(gameId);
      }
    } catch (error) {
      logger.error("Error canceling download:", error);
    }
  }

  static async pauseDownload() {
    if (this.game) {
      const torrent = this.downloads.get(this.game.id);
      if (torrent) {
        torrent.pause();
      }
      this.game = null;
      this.realDebridTorrentId = null;
      WindowManager.mainWindow?.setProgressBar(-1);
      if (this.statusUpdateInterval) {
        clearInterval(this.statusUpdateInterval);
        this.statusUpdateInterval = null;
      }
    }
  }

  static async resumeDownload(game: Game) {
    try {
      if (this.downloads.has(game.id)) {
        const torrent = this.downloads.get(game.id)!;
        torrent.resume();
        this.game = game;
        this.realDebridTorrentId = null;
        this.startStatusUpdateInterval();
      } else {
        return this.startDownload(game);
      }
    } catch (error) {
      logger.error("Error resuming download:", error);
    }
  }

  static async startDownload(game: Game) {
    try {
      const options = { path: game.downloadPath! };

      if (game.downloader === Downloader.RealDebrid) {
        this.realDebridTorrentId = await RealDebridClient.getTorrentId(
          game.uri!
        );
      } else {
        this.startDownloadFromUrl(game.uri!, options);
      }

      this.game = game;
      this.startStatusUpdateInterval();
    } catch (error) {
      logger.error("Error starting download:", error);
    }
  }

  private static startDownloadFromUrl(url: string, options?: any) {
    this.client.add(url, options, (torrent) => {
      this.downloads.set(this.game!.id, torrent);

      torrent.on("download", () => {
        // We handle status updates with a setInterval now
      });

      torrent.on("done", () => {
        this.updateDownloadStatus();
      });

      torrent.on("error", (err) => {
        logger.error("Torrent error:", err);
      });
    });
  }

  private static startStatusUpdateInterval() {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
    }
    this.statusUpdateInterval = setInterval(() => {
      this.updateDownloadStatus();
    }, 5000); // Update every 5 seconds
  }
}
