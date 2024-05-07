import { Game } from "@main/entity";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import path from "node:path";
import { GameStatus } from "@shared";
import { fullArchive } from "node-7z-archive";
import fs from "fs";

import { Downloader } from "./downloader";
import { RealDebridClient } from "../real-debrid";
import { Aria2Download, Aria2DownloadStatus, Aria2Service } from "../aria2";

export class RealDebridDownloader extends Downloader {
  private static download: Aria2Download | null = null;

  private static createFolderIfNotExists(path: string) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path);
    }
  }

  private static getFileNameWithoutExtension(filePath: string) {
    return path.basename(filePath, path.extname(filePath));
  }

  static async startDecompression(
    rarFile: string,
    dest: string,
    game: Game
  ) {
    const directory = path.join(game.downloadPath!, dest);
    await fullArchive(rarFile, directory);
    const updatePayload: QueryDeepPartialEntity<Game> = {
      status: GameStatus.Finished,
      progress: 1,
    };

    await this.updateGameProgress(game.id, updatePayload, {
      timeRemaining: 0,
    });
  }

  static async startDownload(game: Game) {
    if (this.download) this.download.cancel();
    const downloadUrl = await RealDebridClient.getDownloadUrl(game);
    const rdPath = path.join(game.downloadPath!, ".rd");

    this.createFolderIfNotExists(rdPath);

    this.download = await Aria2Service.addHttpDownload(downloadUrl, rdPath);

    let lastStatus: Aria2DownloadStatus;

    this.download.on("onPoll", async (status) => {
      lastStatus = status;
      console.log(status);
      const updatePayload: QueryDeepPartialEntity<Game> = {
        fileSize: status.size,
        status: GameStatus.Downloading,
        progress: Math.min(0.99, status.progress),
        bytesDownloaded: status.bytesDownloaded,
        folderName: this.getFileNameWithoutExtension(status.filePath),
      };

      const downloadStatus = {
        downloadSpeed: status.downloadSpeed,
        timeRemaining: status.timeRemaining * 1000,
      };

      await this.updateGameProgress(game.id, updatePayload, downloadStatus);
    });

    this.download.on("onDownloadComplete", async () => {
      const updatePayload: QueryDeepPartialEntity<Game> = {
        status: GameStatus.Decompressing,
        progress: 0.99,
      };

      await this.updateGameProgress(game.id, updatePayload, {
        timeRemaining: 0,
      });

      this.startDecompression(
        lastStatus.filePath,
        this.getFileNameWithoutExtension(lastStatus.filePath),
        game
      );
    });
  }

  static cancelDownload() {
    if (this.download) {
      this.download.cancel();
    }
  }

  static resumeDownload(game: Game) {
    if (this.download) {
      this.download.resume();
    } else {
      this.startDownload(game);
    }
  }

  static pauseDownload() {
    if (this.download) {
      this.download.pause();
    }
  }
}
