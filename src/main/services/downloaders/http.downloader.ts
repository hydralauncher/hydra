import { Game } from "@main/entity";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import path from "node:path";
import fs from "node:fs";
import EasyDL from "easydl";
import { GameStatus } from "@shared";

import { Downloader } from "./downloader";
import { RealDebridClient } from "../real-debrid";

export class HTTPDownloader extends Downloader {
  private static download: EasyDL;
  private static downloadSize = 0;

  private static getEta(bytesDownloaded: number, speed: number) {
    const remainingBytes = this.downloadSize - bytesDownloaded;

    if (remainingBytes >= 0 && speed > 0) {
      return (remainingBytes / speed) * 1000;
    }

    return 1;
  }

  static async getDownloadUrl(game: Game) {
    const torrents = await RealDebridClient.getAllTorrentsFromUser();
    const hash = RealDebridClient.extractSHA1FromMagnet(game!.repack.magnet);
    let torrent = torrents.find((t) => t.hash === hash);

    if (!torrent) {
      const magnet = await RealDebridClient.addMagnet(game!.repack.magnet);

      if (magnet && magnet.id) {
        await RealDebridClient.selectAllFiles(magnet.id);
        torrent = await RealDebridClient.getInfo(magnet.id);
      }
    }

    if (torrent) {
      const { links } = torrent;
      const { download } = await RealDebridClient.unrestrictLink(links[0]);

      if (!download) {
        throw new Error("Torrent not cached on Real Debrid");
      }

      return download;
    }

    throw new Error();
  }

  private static createFolderIfNotExists(path: string) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path);
    }
  }

  static async startDownload(game: Game) {
    if (this.download) this.download.destroy();
    const downloadUrl = await this.getDownloadUrl(game);

    const filename = path.basename(downloadUrl);
    const folderName = path.basename(filename, path.extname(filename));

    const fullDownloadPath = path.join(game.downloadPath!, folderName);

    this.createFolderIfNotExists(fullDownloadPath);

    this.download = new EasyDL(downloadUrl, fullDownloadPath);

    const metadata = await this.download.metadata();

    this.downloadSize = metadata.size;

    const updatePayload: QueryDeepPartialEntity<Game> = {
      status: GameStatus.Downloading,
      fileSize: metadata.size,
      folderName: folderName,
    };

    const downloadStatus = {
      timeRemaining: Number.POSITIVE_INFINITY,
    };

    await this.updateGameProgress(game.id, updatePayload, downloadStatus);

    this.download.on("progress", async ({ total }) => {
      const updatePayload: QueryDeepPartialEntity<Game> = {
        status:
          total.percentage === 100
            ? GameStatus.Finished
            : GameStatus.Downloading,
        progress: total.percentage / 100,
        bytesDownloaded: total.bytes,
      };

      const downloadStatus = {
        downloadSpeed: total.speed,
        timeRemaining: this.getEta(total.bytes ?? 0, total.speed ?? 0),
      };

      await this.updateGameProgress(game.id, updatePayload, downloadStatus);
    });
  }

  static destroy() {
    if (this.download) {
      this.download.destroy();
    }
  }
}
