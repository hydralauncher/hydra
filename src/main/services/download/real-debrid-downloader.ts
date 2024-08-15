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
      let torrentInfo = await RealDebridClient.getTorrentInfo(
        this.realDebridTorrentId
      );

      if (torrentInfo.status === "waiting_files_selection") {
        await RealDebridClient.selectAllFiles(this.realDebridTorrentId);

        torrentInfo = await RealDebridClient.getTorrentInfo(
          this.realDebridTorrentId
        );
      }

      const { links, status } = torrentInfo;

      if (status === "downloaded") {
        const [link] = links;

        const { download } = await RealDebridClient.unrestrictLink(link);
        return decodeURIComponent(download);
      }

      return null;
    }

    if (this.downloadingGame?.uri) {
      const { download } = await RealDebridClient.unrestrictLink(
        this.downloadingGame?.uri
      );

      return decodeURIComponent(download);
    }

    return null;
  }

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

        if (progress === 1) {
          this.downloads.delete(this.downloadingGame.id);
          this.realDebridTorrentId = null;
          this.downloadingGame = null;
        }

        return result;
      }
    }

    return null;
  }

  static async pauseDownload() {
    if (this.downloadingGame) {
      const gid = this.downloads.get(this.downloadingGame.id);
      if (gid) {
        await HttpDownload.pauseDownload(gid);
      }
    }

    this.realDebridTorrentId = null;
    this.downloadingGame = null;
  }

  static async startDownload(game: Game) {
    if (this.downloads.has(game.id)) {
      await this.resumeDownload(game.id!);
      this.downloadingGame = game;
      return;
    }

    if (game.uri?.startsWith("magnet:")) {
      this.realDebridTorrentId = await RealDebridClient.getTorrentId(
        game!.uri!
      );
    }

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

    this.realDebridTorrentId = null;
    this.downloadingGame = null;
  }

  static async resumeDownload(gameId: number) {
    const gid = this.downloads.get(gameId);

    if (gid) {
      await HttpDownload.resumeDownload(gid);
    }
  }
}
