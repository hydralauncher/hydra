import { Game } from "@main/entity";
import { TorBoxClient } from "../torbox";
import { HttpDownload } from "./http-download";
import { GenericHttpDownloader } from "./generic-http-downloader";

export class TorBoxDownloader extends GenericHttpDownloader {
  private static torboxTorrentId: number | null = null;

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
