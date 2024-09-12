import { Game } from "@main/entity";
import { TorBoxClient } from "../torbox";
import { HttpDownload } from "./http-download";
import { GenericHttpDownloader } from "./generic-http-downloader";
import { gameRepository } from "@main/repository";
// import { calculateETA } from "./helpers";
import { DownloadProgress } from "@types";

export class TorBoxDownloader extends GenericHttpDownloader {
  private static torboxTorrentId: number | null = null;

  public static async getStatus() {
    if (this.downloadingGame) {
      const download = this.downloads.get(this.downloadingGame.id)!;
      const status = download.getStatus();

      if (status) {
        var progress =
          Number(status.completedLength) / Number(status.totalLength) || 0;

        if (progress === Infinity) {
          progress = 0;
        }

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
          timeRemaining: -1,
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

  private static async getTorBoxDownloadUrl() {
    if (this.torboxTorrentId) {
      const torrentInfo = await TorBoxClient.getTorrentInfo(
        this.torboxTorrentId
      );

      if (!torrentInfo) {
        return null;
      }

      const { cached, id } = torrentInfo;

      if (cached) {
        // download as a zip
        const response = await TorBoxClient.requestLink(id);

        if (!response) {
          return null;
        }
        return decodeURIComponent(response);
      }

      return null;
    }

    if (this.downloadingGame?.id) {
      const response = await TorBoxClient.requestLink(this.downloadingGame?.id);

      if (!response) {
        return null;
      }

      return decodeURIComponent(response);
    }

    return null;
  }

  static async startDownload(game: Game) {
    if (this.downloads.has(game.id)) {
      await this.resumeDownload(game.id!);
      this.downloadingGame = game;
      return;
    }

    if (game.uri?.startsWith("magnet:")) {
      this.torboxTorrentId = await TorBoxClient.getTorrentId(game!.uri!);
    }

    this.downloadingGame = game;

    const downloadUrl = await this.getTorBoxDownloadUrl();

    if (downloadUrl) {
      this.torboxTorrentId = null;

      const httpDownload = new HttpDownload(game.downloadPath!, downloadUrl);

      httpDownload.startDownload();

      this.downloads.set(game.id!, httpDownload);
    }
  }
}
