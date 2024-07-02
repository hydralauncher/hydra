import { Game } from "@main/entity";
import { Downloader } from "@shared";
import { TorrentDownloader } from "./torrent-downloader";
import { WindowManager } from "../window-manager";
import { downloadQueueRepository, gameRepository } from "@main/repository";
import { publishDownloadCompleteNotification } from "../notifications";
import { RealDebridDownloader } from "./real-debrid-downloader";
import type { DownloadProgress } from "@types";

export class DownloadManager {
  private static currentDownloader: Downloader | null = null;

  public static async watchDownloads() {
    let status: DownloadProgress | null = null;

    if (this.currentDownloader === Downloader.RealDebrid) {
      status = await RealDebridDownloader.getStatus();
    } else {
      status = await TorrentDownloader.getStatus();
    }

    if (status) {
      const { gameId, progress } = status;

      const game = await gameRepository.findOne({
        where: { id: gameId, isDeleted: false },
      });

      if (WindowManager.mainWindow && game) {
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

      if (progress === 1 && game) {
        publishDownloadCompleteNotification(game);

        await downloadQueueRepository.delete({ game });

        const [nextQueueItem] = await downloadQueueRepository.find({
          order: {
            id: "DESC",
          },
          relations: {
            game: true,
          },
        });

        if (nextQueueItem) {
          this.resumeDownload(nextQueueItem.game);
        }
      }
    }
  }

  static async pauseDownload() {
    if (this.currentDownloader === Downloader.RealDebrid) {
      RealDebridDownloader.pauseDownload();
    } else {
      await TorrentDownloader.pauseDownload();
    }

    WindowManager.mainWindow?.setProgressBar(-1);
    this.currentDownloader = null;
  }

  static async resumeDownload(game: Game) {
    if (game.downloader === Downloader.RealDebrid) {
      RealDebridDownloader.startDownload(game);
      this.currentDownloader = Downloader.RealDebrid;
    } else {
      TorrentDownloader.startDownload(game);
      this.currentDownloader = Downloader.Torrent;
    }
  }

  static async cancelDownload(gameId: number) {
    if (this.currentDownloader === Downloader.RealDebrid) {
      RealDebridDownloader.cancelDownload(gameId);
    } else {
      TorrentDownloader.cancelDownload(gameId);
    }

    WindowManager.mainWindow?.setProgressBar(-1);
    this.currentDownloader = null;
  }

  static async startDownload(game: Game) {
    if (game.downloader === Downloader.RealDebrid) {
      RealDebridDownloader.startDownload(game);
      this.currentDownloader = Downloader.RealDebrid;
    } else {
      TorrentDownloader.startDownload(game);
      this.currentDownloader = Downloader.Torrent;
    }
  }
}
