import { Game } from "@main/entity";
import { RealDebridClient } from "../real-debrid";
import { gameRepository } from "@main/repository";
import { calculateETA } from "./helpers";
import { DownloadProgress } from "@types";
import { HttpDownload } from "./http-download";

export class RealDebridDownloader {
  private static downloadingGame: Game | null = null;

  private static realDebridTorrentId: string | null = null;
  private static httpDownload: HttpDownload | null = null;

  private static async getRealDebridDownloadUrl() {
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
    }

    return null;
  }

  public static async getStatus() {
    const lastProgressEvent = this.httpDownload?.lastProgressEvent;

    if (lastProgressEvent) {
      await gameRepository.update(
        { id: this.downloadingGame!.id },
        {
          bytesDownloaded: lastProgressEvent.loaded,
          fileSize: lastProgressEvent.total,
          progress: lastProgressEvent.progress,
          status: "active",
        }
      );

      const progress = {
        numPeers: 0,
        numSeeds: 0,
        downloadSpeed: lastProgressEvent.rate,
        timeRemaining: calculateETA(
          lastProgressEvent.total ?? 0,
          lastProgressEvent.loaded,
          lastProgressEvent.rate ?? 0
        ),
        isDownloadingMetadata: false,
        isCheckingFiles: false,
        progress: lastProgressEvent.progress,
        gameId: this.downloadingGame!.id,
      } as DownloadProgress;

      if (lastProgressEvent.progress === 1) {
        this.pauseDownload();
      }

      return progress;
    }

    if (this.realDebridTorrentId && this.downloadingGame) {
      const torrentInfo = await RealDebridClient.getTorrentInfo(
        this.realDebridTorrentId
      );

      const { status } = torrentInfo;

      if (status === "downloaded") {
        this.startDownload(this.downloadingGame);
      }

      const progress = torrentInfo.progress / 100;
      const totalDownloaded = progress * torrentInfo.bytes;

      return {
        numPeers: 0,
        numSeeds: torrentInfo.seeders,
        downloadSpeed: torrentInfo.speed,
        timeRemaining: calculateETA(
          torrentInfo.bytes,
          totalDownloaded,
          torrentInfo.speed
        ),
        isDownloadingMetadata: status === "magnet_conversion",
      } as DownloadProgress;
    }

    return null;
  }

  static async pauseDownload() {
    this.httpDownload?.pauseDownload();
    this.realDebridTorrentId = null;
    this.downloadingGame = null;
  }

  static async startDownload(game: Game) {
    this.realDebridTorrentId = await RealDebridClient.getTorrentId(game!.uri!);
    this.downloadingGame = game;

    const downloadUrl = await this.getRealDebridDownloadUrl();

    if (downloadUrl) {
      this.realDebridTorrentId = null;
      this.httpDownload = new HttpDownload(downloadUrl, game!.downloadPath!);
      this.httpDownload.startDownload();
    }
  }

  static cancelDownload() {
    return this.httpDownload?.cancelDownload();
  }
}
