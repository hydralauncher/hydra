import { Game } from "@main/entity";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import path from "node:path";
import EasyDL from "easydl";
import { GameStatus } from "@shared";

import { Downloader } from "./downloader";
import { RealDebridClient } from "../real-debrid";

export class RealDebridDownloader extends Downloader {
  private static download: EasyDL;
  private static downloadSize = 0;

  private static getEta(bytesDownloaded: number, speed: number) {
    const remainingBytes = this.downloadSize - bytesDownloaded;

    if (remainingBytes >= 0 && speed > 0) {
      return (remainingBytes / speed) * 1000;
    }

    return 1;
  }

  static async startDownload(game: Game) {
    if (this.download) this.download.destroy();
    const downloadUrl = await RealDebridClient.getDownloadUrl(game);

    this.download = new EasyDL(
      downloadUrl,
      path.join(game.downloadPath!, ".rd")
    );
    const metadata = await this.download.metadata();

    this.downloadSize = metadata.size;

    const updatePayload: QueryDeepPartialEntity<Game> = {
      status: GameStatus.Downloading,
      fileSize: metadata.size,
      folderName: game.repack.title,
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
