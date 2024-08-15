import { Game } from "@main/entity";
import { gameRepository } from "@main/repository";
import { calculateETA } from "./helpers";
import { DownloadProgress } from "@types";
import { HttpDownload } from "./http-download";

export class GenericHTTPDownloader {
  private static downloads = new Map<number, string>();
  private static downloadingGame: Game | null = null;

  public static async getStatus() {
    if (this.downloadingGame) {
      const gid = this.downloads.get(this.downloadingGame.id)!;
      const status = HttpDownload.getStatus(gid);

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
      const gid = this.downloads.get(this.downloadingGame!.id!);

      if (gid) {
        await HttpDownload.pauseDownload(gid);
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

    const gid = await HttpDownload.startDownload(
      game.downloadPath!,
      downloadUrl,
      headers
    );

    this.downloads.set(game.id!, gid);
  }

  static async cancelDownload(gameId: number) {
    const gid = this.downloads.get(gameId);

    if (gid) {
      await HttpDownload.cancelDownload(gid);
      this.downloads.delete(gameId);
    }
  }

  static async resumeDownload(gameId: number) {
    const gid = this.downloads.get(gameId);

    if (gid) {
      await HttpDownload.resumeDownload(gid);
    }
  }
}
