import { Game } from "@main/entity";
import { gameRepository } from "@main/repository";
import { calculateETA } from "./helpers";
import { DownloadProgress } from "@types";
import { HttpDownload } from "./http-download";

export class GenericHttpDownloader {
  public static downloads = new Map<number, HttpDownload>();
  public static downloadingGame: Game | null = null;

  public static async getStatus() {
    if (this.downloadingGame) {
      const download = this.downloads.get(this.downloadingGame.id)!;
      const status = download.getStatus();

      if (status) {
        const progress =
          Number(status.completedLength) / Number(status.totalLength);

        await gameRepository.update(
          { id: this.downloadingGame!.id },
          {
            bytesDownloaded: Number(status.completedLength),
            fileSize: Number(status.totalLength),
            progress,
            status: "active",
            folderName: status.folderName,
          }
        );

        const result = {
          numPeers: 0,
          numSeeds: 0,
          downloadSpeed: status.downloadSpeed,
          timeRemaining: calculateETA(
            status.totalLength,
            status.completedLength,
            status.downloadSpeed
          ),
          isDownloadingMetadata: false,
          isCheckingFiles: false,
          progress,
          gameId: this.downloadingGame!.id,
        } as DownloadProgress;

        if (progress === 1) {
          this.downloads.delete(this.downloadingGame.id);
          this.downloadingGame = null;
        }

        return result;
      }
    }

    return null;
  }

  static async pauseDownload() {
    if (this.downloadingGame) {
      const httpDownload = this.downloads.get(this.downloadingGame!.id!);

      if (httpDownload) {
        await httpDownload.pauseDownload();
      }

      this.downloadingGame = null;
    }
  }

  static async startDownload(
    game: Game,
    downloadUrl: string,
    headers?: Record<string, string>
  ) {
    this.downloadingGame = game;

    if (this.downloads.has(game.id)) {
      await this.resumeDownload(game.id!);
      return;
    }

    const httpDownload = new HttpDownload(
      game.downloadPath!,
      downloadUrl,
      headers
    );

    httpDownload.startDownload();

    this.downloads.set(game.id!, httpDownload);
  }

  static async cancelDownload(gameId: number) {
    const httpDownload = this.downloads.get(gameId);

    if (httpDownload) {
      await httpDownload.cancelDownload();
      this.downloads.delete(gameId);
    }
  }

  static async resumeDownload(gameId: number) {
    const httpDownload = this.downloads.get(gameId);

    if (httpDownload) {
      await httpDownload.resumeDownload();
    }
  }
}
