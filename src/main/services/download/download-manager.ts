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
import { calculateETA, getDirSize } from "./helpers";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { RealDebridClient } from "./real-debrid";
import path from "path";
import { logger } from "../logger";

export class DownloadManager {
  private static downloadingGameId: number | null = null;

  public static async startRPC(game?: Game, initialSeeding?: Game[]) {
    PythonRPC.spawn(
      game?.status === "active"
        ? await this.getDownloadPayload(game).catch(() => undefined)
        : undefined,
      initialSeeding?.map((game) => ({
        game_id: game.id,
        url: game.uri!,
        save_path: game.downloadPath!,
      }))
    );

    this.downloadingGameId = game?.id ?? null;
  }

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

    if (status) {
      const { gameId, progress } = status;
      const game = await gameRepository.findOne({
        where: { id: gameId, isDeleted: false },
      });
      const userPreferences = await userPreferencesRepository.findOneBy({
        id: 1,
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

        if (
          userPreferences?.seedAfterDownloadComplete &&
          game.downloader === Downloader.Torrent
        ) {
          gameRepository.update(
            { id: gameId },
            { status: "seeding", shouldSeed: true }
          );
        } else {
          gameRepository.update(
            { id: gameId },
            { status: "complete", shouldSeed: false }
          );

          this.cancelDownload(gameId);
        }

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
        } else {
          this.downloadingGameId = -1;
        }
      }
    }
  }

  public static async getSeedStatus() {
    const seedStatus = await PythonRPC.rpc
      .get<LibtorrentPayload[] | []>("/seed-status")
      .then((res) => res.data);

    if (!seedStatus.length) return;

    logger.log(seedStatus);

    seedStatus.forEach(async (status) => {
      const game = await gameRepository.findOne({
        where: { id: status.gameId },
      });

      if (!game) return;

      const totalSize = await getDirSize(
        path.join(game.downloadPath!, status.folderName)
      );

      if (totalSize < status.fileSize) {
        await this.cancelDownload(game.id);

        await gameRepository.update(game.id, {
          status: "paused",
          shouldSeed: false,
          progress: totalSize / status.fileSize,
        });

        WindowManager.mainWindow?.webContents.send("on-hard-delete");
      }
    });

    WindowManager.mainWindow?.webContents.send("on-seeding-status", seedStatus);
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

    if (gameId === this.downloadingGameId) {
      this.downloadingGameId = null;
    }
  }

  static async resumeSeeding(game: Game) {
    await PythonRPC.rpc.post("/action", {
      action: "resume_seeding",
      game_id: game.id,
      url: game.uri,
      save_path: game.downloadPath,
    });
  }

  static async pauseSeeding(gameId: number) {
    await PythonRPC.rpc.post("/action", {
      action: "pause_seeding",
      game_id: gameId,
    });
  }

  private static async getDownloadPayload(game: Game) {
    switch (game.downloader) {
      case Downloader.Gofile: {
        const id = game.uri!.split("/").pop();

        const token = await GofileApi.authorize();
        const downloadLink = await GofileApi.getDownloadLink(id!);

        return {
          action: "start",
          game_id: game.id,
          url: downloadLink,
          save_path: game.downloadPath!,
          header: `Cookie: accountToken=${token}`,
        };
      }
      case Downloader.PixelDrain: {
        const id = game.uri!.split("/").pop();

        return {
          action: "start",
          game_id: game.id,
          url: `https://pixeldrain.com/api/file/${id}?download`,
          save_path: game.downloadPath!,
        };
      }
      case Downloader.Qiwi: {
        const downloadUrl = await QiwiApi.getDownloadUrl(game.uri!);

        return {
          action: "start",
          game_id: game.id,
          url: downloadUrl,
          save_path: game.downloadPath!,
        };
      }
      case Downloader.Torrent:
        return {
          action: "start",
          game_id: game.id,
          url: game.uri!,
          save_path: game.downloadPath!,
        };
      case Downloader.RealDebrid: {
        const downloadUrl = await RealDebridClient.getDownloadUrl(game.uri!);

        return {
          action: "start",
          game_id: game.id,
          url: downloadUrl!,
          save_path: game.downloadPath!,
        };
      }
    }
  }

  static async startDownload(game: Game) {
    const payload = await this.getDownloadPayload(game);

    await PythonRPC.rpc.post("/action", payload);

    this.downloadingGameId = game.id;
  }
}
