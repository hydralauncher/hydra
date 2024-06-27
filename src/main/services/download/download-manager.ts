import { Game } from "@main/entity";
import { Downloader } from "@shared";
import { TorrentDownloader } from "./torrent-downloader";
import { WindowManager } from "../window-manager";
import { downloadQueueRepository, gameRepository } from "@main/repository";
import { publishDownloadCompleteNotification } from "../notifications";

export class DownloadManager {
  private static currentDownloader: Downloader | null = null;

  public static async watchDownloads() {
    if (this.currentDownloader === Downloader.RealDebrid) {
      throw new Error();
    } else {
      const status = await TorrentDownloader.getStatus();

      if (status) {
        const { gameId, progress } = status;

        const game = await gameRepository.findOne({
          where: { id: gameId, isDeleted: false },
        });

        if (WindowManager.mainWindow && game) {
          WindowManager.mainWindow.setProgressBar(
            progress === 1 ? -1 : progress
          );

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

        if (status.progress === 1 && game) {
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
  }

  static async pauseDownload() {
    if (this.currentDownloader === Downloader.RealDebrid) {
      throw new Error();
    } else {
      await TorrentDownloader.pauseDownload();
    }

    WindowManager.mainWindow?.setProgressBar(-1);
    this.currentDownloader = null;
  }

  static async resumeDownload(game: Game) {
    if (game.downloader === Downloader.RealDebrid) {
      throw new Error();
    } else {
      TorrentDownloader.startDownload(game);
      this.currentDownloader = Downloader.Torrent;
    }
  }

  static async cancelDownload(gameId: number) {
    if (this.currentDownloader === Downloader.RealDebrid) {
      throw new Error();
    } else {
      TorrentDownloader.cancelDownload(gameId);
    }

    WindowManager.mainWindow?.setProgressBar(-1);
    this.currentDownloader = null;
  }

  static async startDownload(game: Game) {
    if (game.downloader === Downloader.RealDebrid) {
      throw new Error();
    } else {
      TorrentDownloader.startDownload(game);
      this.currentDownloader = Downloader.Torrent;
    }
  }
}
