import { Game } from "@main/entity";
import { Downloader } from "@shared";
import { WindowManager } from "../window-manager";
import {
  downloadQueueRepository,
  gameRepository,
  userPreferencesRepository,
} from "@main/repository";
import { publishDownloadCompleteNotification } from "../notifications";
import type { DownloadProgress } from "@types";
import { GofileApi, QiwiApi } from "../hosters";
import { PythonRPC } from "../python-rpc";
import {
  LibtorrentPayload,
  LibtorrentStatus,
  PauseDownloadPayload,
} from "./types";
import { calculateETA } from "./helpers";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { RealDebridClient } from "./real-debrid";

export class DownloadManager {
  private static downloadingGameId: number | null = null;

  private static async getDownloadStatus() {
    const response = await PythonRPC.rpc.get<LibtorrentPayload | null>(
      "/status"
    );

    if (response.data === null || !this.downloadingGameId) return null;

    const gameId = this.downloadingGameId;

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
      } = response.data;

      const isDownloadingMetadata =
        status === LibtorrentStatus.DownloadingMetadata;

      const isCheckingFiles = status === LibtorrentStatus.CheckingFiles;

      if (!isDownloadingMetadata && !isCheckingFiles) {
        const update: QueryDeepPartialEntity<Game> = {
          bytesDownloaded,
          fileSize,
          progress,
          status: "active",
        };

        await gameRepository.update(
          { id: gameId },
          {
            ...update,
            folderName,
          }
        );
      }

      if (progress === 1 && !isCheckingFiles) {
        const userPreferences = await userPreferencesRepository.findOneBy({
          id: 1,
        });

        if (userPreferences?.seedAfterDownloadComplete) {
          gameRepository.update(
            { id: gameId },
            { status: "seeding", shouldSeed: true }
          );
        } else {
          gameRepository.update(
            { id: gameId },
            { status: "complete", shouldSeed: false }
          );

          this.pauseSeeding(gameId);
        }

        this.downloadingGameId = -1;
      }

      return {
        numPeers,
        numSeeds,
        downloadSpeed,
        timeRemaining: calculateETA(fileSize, bytesDownloaded, downloadSpeed),
        isDownloadingMetadata,
        isCheckingFiles,
        progress,
        gameId,
      } as DownloadProgress;
    } catch (err) {
      return null;
    }
  }

  public static async watchDownloads() {
    const status = await this.getDownloadStatus();

    //   // status = await RealDebridDownloader.getStatus();

    if (status) {
      const { gameId, progress } = status;
      const game = await gameRepository.findOne({
        where: { id: gameId, isDeleted: false },
      });

      if (WindowManager.mainWindow && game) {
        WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);
        WindowManager.mainWindow.webContents.send(
          "on-download-progress",
          JSON.parse(
            JSON.stringify({
              ...status,
              game,
            })
          )
        );
      }
      if (progress === 1 && game) {
        publishDownloadCompleteNotification(game);
        await downloadQueueRepository.delete({ game });
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
    }
  }

  public static async getSeedStatus() {
    // const gamesToSeed = await gameRepository.find({
    //   where: { shouldSeed: true, isDeleted: false },
    // });
    // if (gamesToSeed.length === 0) return;
    // const seedStatus = await PythonRPC.rpc
    //   .get<LibtorrentPayload[] | null>("/seed-status")
    //   .then((results) => {
    //     if (results === null) return [];
    //     return results.data;
    //   });
    // if (!seedStatus.length === 0) {
    //   for (const game of gamesToSeed) {
    //     if (game.uri && game.downloadPath) {
    //       await this.resumeSeeding(game.id, game.uri, game.downloadPath);
    //     }
    //   }
    // }
    // const gameIds = seedStatus.map((status) => status.gameId);
    // for (const gameId of gameIds) {
    //   const game = await gameRepository.findOne({
    //     where: { id: gameId },
    //   });
    //   if (game) {
    //     const isNotDeleted = fs.existsSync(
    //       path.join(game.downloadPath!, game.folderName!)
    //     );
    //     if (!isNotDeleted) {
    //       await this.pauseSeeding(game.id);
    //       await gameRepository.update(game.id, {
    //         status: "complete",
    //         shouldSeed: false,
    //       });
    //       WindowManager.mainWindow?.webContents.send("on-hard-delete");
    //     }
    //   }
    // }
    // const updateList = await gameRepository.find({
    //   where: {
    //     id: In(gameIds),
    //     status: Not(In(["complete", "seeding"])),
    //     shouldSeed: true,
    //     isDeleted: false,
    //   },
    // });
    // if (updateList.length > 0) {
    //   await gameRepository.update(
    //     { id: In(updateList.map((game) => game.id)) },
    //     { status: "seeding" }
    //   );
    // }
    // WindowManager.mainWindow?.webContents.send(
    //   "on-seeding-status",
    //   JSON.parse(JSON.stringify(seedStatus))
    // );
  }

  static async pauseSeeding(gameId: number) {
    // await TorrentDownloader.pauseSeeding(gameId);
  }

  static async resumeSeeding(gameId: number, magnet: string, savePath: string) {
    // await TorrentDownloader.resumeSeeding(gameId, magnet, savePath);
  }

  static async pauseDownload() {
    await PythonRPC.rpc
      .post("/action", {
        action: "pause",
        game_id: this.downloadingGameId,
      } as PauseDownloadPayload)
      .catch(() => {});

    WindowManager.mainWindow?.setProgressBar(-1);

    this.downloadingGameId = null;
  }

  static async resumeDownload(game: Game) {
    return this.startDownload(game);
  }

  static async cancelDownload(gameId = this.downloadingGameId!) {
    await PythonRPC.rpc.post("/action", {
      action: "cancel",
      game_id: gameId,
    });

    WindowManager.mainWindow?.setProgressBar(-1);

    this.downloadingGameId = null;
  }

  static async startDownload(game: Game) {
    switch (game.downloader) {
      case Downloader.Gofile: {
        const id = game!.uri!.split("/").pop();

        const token = await GofileApi.authorize();
        const downloadLink = await GofileApi.getDownloadLink(id!);

        await PythonRPC.rpc.post("/action", {
          action: "start",
          game_id: game.id,
          url: downloadLink,
          save_path: game.downloadPath,
          header: `Cookie: accountToken=${token}`,
        });
        break;
      }
      case Downloader.PixelDrain: {
        const id = game!.uri!.split("/").pop();

        await PythonRPC.rpc.post("/action", {
          action: "start",
          game_id: game.id,
          url: `https://pixeldrain.com/api/file/${id}?download`,
          save_path: game.downloadPath,
        });
        break;
      }
      case Downloader.Qiwi: {
        const downloadUrl = await QiwiApi.getDownloadUrl(game.uri!);

        await PythonRPC.rpc.post("/action", {
          action: "start",
          game_id: game.id,
          url: downloadUrl,
          save_path: game.downloadPath,
        });
        break;
      }
      case Downloader.Torrent:
        await PythonRPC.rpc.post("/action", {
          action: "start",
          game_id: game.id,
          url: game.uri,
          save_path: game.downloadPath,
        });
        break;
      case Downloader.RealDebrid: {
        const downloadUrl = await RealDebridClient.getDownloadUrl(game.uri!);

        await PythonRPC.rpc.post("/action", {
          action: "start",
          game_id: game.id,
          url: downloadUrl,
          save_path: game.downloadPath,
        });
      }
    }

    this.downloadingGameId = game.id;
  }
}
