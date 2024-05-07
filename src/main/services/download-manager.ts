import { gameRepository } from "@main/repository";

import type { Game } from "@main/entity";
import { Downloader } from "@shared";

import { writePipe } from "./fifo";
import { RealDebridDownloader } from "./downloaders";

export class DownloadManager {
  private static gameDownloading: Game;

  static async getGame(gameId: number) {
    return gameRepository.findOne({
      where: { id: gameId, isDeleted: false },
      relations: {
        repack: true,
      },
    });
  }

  static async cancelDownload() {
    if (
      this.gameDownloading &&
      this.gameDownloading.downloader === Downloader.Torrent
    ) {
      writePipe.write({ action: "cancel" });
    } else {
      RealDebridDownloader.cancelDownload();
    }
  }

  static async pauseDownload() {
    if (
      this.gameDownloading &&
      this.gameDownloading.downloader === Downloader.Torrent
    ) {
      writePipe.write({ action: "pause" });
    } else {
      RealDebridDownloader.pauseDownload();
    }
  }

  static async resumeDownload(gameId: number) {
    const game = await this.getGame(gameId);

    if (game!.downloader === Downloader.Torrent) {
      writePipe.write({
        action: "start",
        game_id: game!.id,
        magnet: game!.repack.magnet,
        save_path: game!.downloadPath,
      });
    } else {
      RealDebridDownloader.resumeDownload(game!);
    }

    this.gameDownloading = game!;
  }

  static async downloadGame(gameId: number) {
    const game = await this.getGame(gameId);

    if (game!.downloader === Downloader.Torrent) {
      writePipe.write({
        action: "start",
        game_id: game!.id,
        magnet: game!.repack.magnet,
        save_path: game!.downloadPath,
      });
    } else {
      RealDebridDownloader.startDownload(game!);
    }

    this.gameDownloading = game!;
  }
}
