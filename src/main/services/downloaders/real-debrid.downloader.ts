import { Game } from "@main/entity";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import path from "node:path";
import fs from "node:fs";
import EasyDL from "easydl";
import { GameStatus } from "@shared";
import { fullArchive } from "node-7z-archive";

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

  private static createFolderIfNotExists(path: string) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path);
    }
  }

  private static async startDecompression(
    rarFile: string,
    dest: string,
    game: Game
  ) {
    await fullArchive(rarFile, dest);

    const updatePayload: QueryDeepPartialEntity<Game> = {
      status: GameStatus.Finished,
      progress: 1,
    };

    await this.updateGameProgress(game.id, updatePayload, {
      timeRemaining: 0,
    });
  }

  static destroy() {
    if (this.download) {
      this.download.destroy();
    }
  }

  static async startDownload(game: Game) {
    if (this.download) this.download.destroy();
    const downloadUrl = decodeURIComponent(
      await RealDebridClient.getDownloadUrl(game)
    );

    const filename = path.basename(downloadUrl);
    const folderName = path.basename(filename, path.extname(filename));

    const downloadPath = path.join(game.downloadPath!, folderName);
    this.createFolderIfNotExists(downloadPath);

    this.download = new EasyDL(downloadUrl, path.join(downloadPath, filename));

    const metadata = await this.download.metadata();

    this.downloadSize = metadata.size;

    const updatePayload: QueryDeepPartialEntity<Game> = {
      status: GameStatus.Downloading,
      fileSize: metadata.size,
      folderName,
    };

    const downloadStatus = {
      timeRemaining: Number.POSITIVE_INFINITY,
    };

    await this.updateGameProgress(game.id, updatePayload, downloadStatus);

    this.download.on("progress", async ({ total }) => {
      const updatePayload: QueryDeepPartialEntity<Game> = {
        status: GameStatus.Downloading,
        progress: Math.min(0.99, total.percentage / 100),
        bytesDownloaded: total.bytes,
      };

      const downloadStatus = {
        downloadSpeed: total.speed,
        timeRemaining: this.getEta(total.bytes ?? 0, total.speed ?? 0),
      };

      await this.updateGameProgress(game.id, updatePayload, downloadStatus);
    });

    this.download.on("end", async () => {
      const updatePayload: QueryDeepPartialEntity<Game> = {
        status: GameStatus.Decompressing,
        progress: 0.99,
      };

      await this.updateGameProgress(game.id, updatePayload, {
        timeRemaining: 0,
      });

      this.startDecompression(
        path.join(downloadPath, filename),
        downloadPath,
        game
      );
    });
  }
}
