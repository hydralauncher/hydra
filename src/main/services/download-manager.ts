import cp from "node:child_process";

import { WindowManager } from "./window-manager";

import { Game } from "@main/entity";
import { startTorrentClient } from "./torrent-client";
import { readPipe, writePipe } from "./fifo";
import { downloadQueueRepository, gameRepository } from "@main/repository";
import { publishDownloadCompleteNotification } from "./notifications";
import { DownloadProgress } from "@types";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

enum LibtorrentStatus {
  CheckingFiles = 1,
  DownloadingMetadata = 2,
  Downloading = 3,
  Finished = 4,
  Seeding = 5,
}

const getETA = (
  totalLength: number,
  completedLength: number,
  speed: number
) => {
  const remainingBytes = totalLength - completedLength;

  if (remainingBytes >= 0 && speed > 0) {
    return (remainingBytes / speed) * 1000;
  }

  return -1;
};

export class DownloadManager {
  private static torrentClient: cp.ChildProcess | null = null;
  private static downloadingGameId = -1;

  private static async spawn() {
    this.torrentClient = await startTorrentClient();
  }

  public static kill() {
    if (this.torrentClient) {
      this.torrentClient.kill();
      this.torrentClient = null;
    }
  }

  public static async watchDownloads() {
    if (!this.downloadingGameId) return;

    const buf = readPipe.socket?.read(1024 * 2);

    if (buf === null) return;

    const message = Buffer.from(buf.slice(0, buf.indexOf(0x00))).toString(
      "utf-8"
    );

    try {
      const {
        progress,
        numPeers,
        numSeeds,
        downloadSpeed,
        bytesDownloaded,
        fileSize,
        folderName,
        status,
      } = JSON.parse(message) as {
        progress: number;
        numPeers: number;
        numSeeds: number;
        downloadSpeed: number;
        bytesDownloaded: number;
        fileSize: number;
        folderName: string;
        status: number;
      };

      // TODO: Checking files as metadata is a workaround
      const isDownloadingMetadata =
        status === LibtorrentStatus.DownloadingMetadata ||
        status === LibtorrentStatus.CheckingFiles;

      if (!isDownloadingMetadata) {
        const update: QueryDeepPartialEntity<Game> = {
          bytesDownloaded,
          fileSize,
          progress,
        };

        await gameRepository.update(
          { id: this.downloadingGameId },
          {
            ...update,
            folderName,
          }
        );
      }

      const game = await gameRepository.findOne({
        where: { id: this.downloadingGameId, isDeleted: false },
      });

      if (WindowManager.mainWindow && game) {
        if (!isNaN(progress))
          WindowManager.mainWindow.setProgressBar(
            progress === 1 ? -1 : progress
          );

        const payload = {
          numPeers,
          numSeeds,
          downloadSpeed,
          timeRemaining: getETA(fileSize, bytesDownloaded, downloadSpeed),
          isDownloadingMetadata,
          game,
        } as DownloadProgress;

        WindowManager.mainWindow.webContents.send(
          "on-download-progress",
          JSON.parse(JSON.stringify(payload))
        );
      }

      if (progress === 1 && game) {
        publishDownloadCompleteNotification(game);

        await downloadQueueRepository.delete({ game });

        // Clear download
        this.downloadingGameId = -1;

        const [nextQueueItem] = await downloadQueueRepository.find({
          order: {
            id: "DESC",
          },
          relations: {
            game: true,
          },
        });

        if (nextQueueItem) {
          this.resumeDownload(nextQueueItem.game);
        }
      }
    } catch (err) {
      return;
    }
  }

  static async pauseDownload() {
    writePipe.write({
      action: "pause",
      game_id: this.downloadingGameId,
    });

    this.downloadingGameId = -1;

    WindowManager.mainWindow?.setProgressBar(-1);
  }

  static async resumeDownload(game: Game) {
    this.startDownload(game);
  }

  static async startDownload(game: Game) {
    if (!this.torrentClient) await this.spawn();

    writePipe.write({
      action: "start",
      game_id: game.id,
      magnet: game.uri,
      save_path: game.downloadPath,
    });

    this.downloadingGameId = game.id;
  }

  static async cancelDownload(gameId: number) {
    writePipe.write({ action: "cancel", game_id: gameId });

    WindowManager.mainWindow?.setProgressBar(-1);
  }
}
