import cp from "node:child_process";

import { Game } from "@main/entity";
import {
  RPC_PASSWORD,
  RPC_PORT,
  startTorrentClient as startRPCClient,
} from "./torrent-client";
import { gameRepository } from "@main/repository";
import type { DownloadProgress } from "@types";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { calculateETA } from "./helpers";
import axios from "axios";
import {
  CancelDownloadPayload,
  StartDownloadPayload,
  PauseDownloadPayload,
  LibtorrentStatus,
  LibtorrentPayload,
  ProcessPayload,
} from "./types";
import { pythonInstanceLogger as logger } from "../logger";

export class PythonInstance {
  private static pythonProcess: cp.ChildProcess | null = null;
  private static downloadingGameId = -1;

  private static rpc = axios.create({
    baseURL: `http://localhost:${RPC_PORT}`,
    headers: {
      "x-hydra-rpc-password": RPC_PASSWORD,
    },
  });

  public static spawn(args?: StartDownloadPayload) {
    logger.log("spawning python process with args:", args);
    this.pythonProcess = startRPCClient(args);
  }

  public static kill() {
    if (this.pythonProcess) {
      logger.log("killing python process");
      this.pythonProcess.kill();
      this.pythonProcess = null;
      this.downloadingGameId = -1;
    }
  }

  public static killTorrent() {
    if (this.pythonProcess) {
      logger.log("killing torrent in python process");
      this.rpc.post("/action", { action: "kill-torrent" });
      this.downloadingGameId = -1;
    }
  }

  public static async getProcessList() {
    return (
      (await this.rpc.get<ProcessPayload[] | null>("/process-list")).data || []
    );
  }

  public static async getStatus() {
    if (this.downloadingGameId === -1) return null;

    const response = await this.rpc.get<LibtorrentPayload | null>("/status");

    if (response.data === null) return null;

    console.log(response.data);

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
        gameId,
      } = response.data;

      this.downloadingGameId = gameId;

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

      if (
        progress === 1 &&
        !isCheckingFiles &&
        status !== LibtorrentStatus.Seeding
      ) {
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

  static async pauseDownload() {
    await this.rpc
      .post("/action", {
        action: "pause",
        game_id: this.downloadingGameId,
      } as PauseDownloadPayload)
      .catch(() => {});

    this.downloadingGameId = -1;
  }

  static async startDownload(game: Game) {
    if (!this.pythonProcess) {
      this.spawn({
        game_id: game.id,
        magnet: game.uri!,
        save_path: game.downloadPath!,
      });
    } else {
      await this.rpc
        .post("/action", {
          action: "start",
          game_id: game.id,
          magnet: game.uri,
          save_path: game.downloadPath,
        } as StartDownloadPayload)
        .catch(this.handleRpcError);
    }

    this.downloadingGameId = game.id;
  }

  static async cancelDownload(gameId: number) {
    await this.rpc
      .post("/action", {
        action: "cancel",
        game_id: gameId,
      } as CancelDownloadPayload)
      .catch(() => {});

    this.downloadingGameId = -1;
  }

  static async processProfileImage(imagePath: string) {
    return this.rpc
      .post<{ imagePath: string; mimeType: string }>("/profile-image", {
        image_path: imagePath,
      })
      .then((response) => response.data);
  }

  private static async handleRpcError(_error: unknown) {
    await this.rpc.get("/healthcheck").catch(() => {
      logger.error(
        "RPC healthcheck failed. Killing process and starting again"
      );
      this.kill();
      this.spawn();
    });
  }
}
