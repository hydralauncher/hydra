import { Game } from "@main/entity";
import { RealDebridClient } from "../real-debrid";
import { gameRepository } from "@main/repository";
import { calculateETA } from "./helpers";
import { DownloadProgress } from "@types";
import { HttpDownload } from "./http-download";

export class RealDebridDownloader {
  private static downloads = new Map<number, string>();
  private static downloadingGame: Game | null = null;

  private static realDebridTorrentId: string | null = null;

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
    const status = await HttpDownload.getStatus();

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
        }
      );

      return {
        numPeers: 0,
        numSeeds: 0,
        downloadSpeed: Number(status.downloadSpeed),
        timeRemaining: calculateETA(
          Number(status.totalLength),
          Number(status.completedLength),
          Number(status.downloadSpeed)
        ),
        isDownloadingMetadata: false,
        isCheckingFiles: false,
        progress,
        gameId: this.downloadingGame!.id,
      } as DownloadProgress;
    }

    return null;
  }

  static async pauseDownload() {
    HttpDownload.pauseDownload();
    this.realDebridTorrentId = null;
    this.downloadingGame = null;
  }

  static async startDownload(game: Game) {
    this.realDebridTorrentId = await RealDebridClient.getTorrentId(game!.uri!);
    this.downloadingGame = game;

    const downloadUrl = await this.getRealDebridDownloadUrl();

    if (downloadUrl) {
      this.realDebridTorrentId = null;
      const gid = await HttpDownload.startDownload(
        game.downloadPath!,
        downloadUrl
      );

      this.downloads.set(game.id!, gid);
    }
  }

  static async cancelDownload(gameId: number) {
    const gid = this.downloads.get(gameId);
    if (gid) {
      await HttpDownload.cancelDownload(gid);
      this.downloads.delete(gameId);
    }
  }
}
