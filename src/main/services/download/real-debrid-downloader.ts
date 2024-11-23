import { Game } from "@main/entity";
import { RealDebridClient } from "../real-debrid";
import { HttpDownload } from "./http-download";
import { GenericHttpDownloader } from "./generic-http-downloader";

export class RealDebridDownloader extends GenericHttpDownloader {
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

      const httpDownload = new HttpDownload(game.downloadPath!, downloadUrl);
      httpDownload.startDownload();

      this.downloads.set(game.id!, httpDownload);
    }
  }
}
