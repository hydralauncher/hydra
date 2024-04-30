import path from "node:path";
import cp from "node:child_process";
import fs from "node:fs";
import * as Sentry from "@sentry/electron/main";
import { app, dialog } from "electron";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { Game } from "@main/entity";
import { Downloader } from "./downloader";
import { GameStatus } from "@globals";

const binaryNameByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "hydra-download-manager",
  linux: "hydra-download-manager",
  win32: "hydra-download-manager.exe",
};

enum TorrentState {
  CheckingFiles = 1,
  DownloadingMetadata = 2,
  Downloading = 3,
  Finished = 4,
  Seeding = 5,
}

export interface TorrentUpdate {
  gameId: number;
  progress: number;
  downloadSpeed: number;
  timeRemaining: number;
  numPeers: number;
  numSeeds: number;
  status: TorrentState;
  folderName: string;
  fileSize: number;
  bytesDownloaded: number;
}

export const BITTORRENT_PORT = "5881";

export class TorrentClient {
  public static startTorrentClient(
    writePipePath: string,
    readPipePath: string
  ) {
    const commonArgs = [BITTORRENT_PORT, writePipePath, readPipePath];

    if (app.isPackaged) {
      const binaryName = binaryNameByPlatform[process.platform]!;
      const binaryPath = path.join(
        process.resourcesPath,
        "hydra-download-manager",
        binaryName
      );

      if (!fs.existsSync(binaryPath)) {
        dialog.showErrorBox(
          "Fatal",
          "Hydra download manager binary not found. Please check if it has been removed by Windows Defender."
        );

        app.quit();
      }

      cp.spawn(binaryPath, commonArgs, {
        stdio: "inherit",
        windowsHide: true,
      });
      return;
    }

    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "torrent-client",
      "main.py"
    );

    cp.spawn("python3", [scriptPath, ...commonArgs], {
      stdio: "inherit",
    });
  }

  private static getTorrentStateName(state: TorrentState) {
    if (state === TorrentState.CheckingFiles) return GameStatus.CheckingFiles;
    if (state === TorrentState.Downloading) return GameStatus.Downloading;
    if (state === TorrentState.DownloadingMetadata)
      return GameStatus.DownloadingMetadata;
    if (state === TorrentState.Finished) return GameStatus.Finished;
    if (state === TorrentState.Seeding) return GameStatus.Seeding;
    return "";
  }

  public static async onSocketData(data: Buffer) {
    const message = Buffer.from(data).toString("utf-8");

    try {
      const payload = JSON.parse(message) as TorrentUpdate;

      const updatePayload: QueryDeepPartialEntity<Game> = {
        bytesDownloaded: payload.bytesDownloaded,
        status: this.getTorrentStateName(payload.status),
      };

      if (payload.status === TorrentState.CheckingFiles) {
        updatePayload.fileVerificationProgress = payload.progress;
      } else {
        if (payload.folderName) {
          updatePayload.folderName = payload.folderName;
          updatePayload.fileSize = payload.fileSize;
        }
      }

      if (
        [TorrentState.Downloading, TorrentState.Seeding].includes(
          payload.status
        )
      ) {
        updatePayload.progress = payload.progress;
      }

      Downloader.updateGameProgress(payload.gameId, updatePayload, {
        numPeers: payload.numPeers,
        numSeeds: payload.numSeeds,
        downloadSpeed: payload.downloadSpeed,
        timeRemaining: payload.timeRemaining,
      });
    } catch (err) {
      Sentry.captureException(err);
    }
  }
}