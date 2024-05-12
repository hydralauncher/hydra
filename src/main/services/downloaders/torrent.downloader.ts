import path from "node:path";
import cp from "node:child_process";
import fs from "node:fs";
import * as Sentry from "@sentry/electron/main";
import { app, dialog } from "electron";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { Game } from "@main/entity";
import { GameStatus } from "@shared";
import { Downloader } from "./downloader";
import { readPipe, writePipe } from "../fifo";

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

export class TorrentDownloader extends Downloader {
  private static messageLength = 1024 * 2;

  public static async attachListener() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const buffer = readPipe.socket?.read(this.messageLength);

      if (buffer === null) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const message = Buffer.from(
        buffer.slice(0, buffer.indexOf(0x00))
      ).toString("utf-8");

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

        this.updateGameProgress(payload.gameId, updatePayload, {
          numPeers: payload.numPeers,
          numSeeds: payload.numSeeds,
          downloadSpeed: payload.downloadSpeed,
          timeRemaining: payload.timeRemaining,
        });
      } catch (err) {
        Sentry.captureException(err);
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  public static startClient() {
    return new Promise((resolve) => {
      const commonArgs = [
        BITTORRENT_PORT,
        writePipe.socketPath,
        readPipe.socketPath,
      ];

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
        "torrent-client",
        "main.py"
      );

      cp.spawn("python3", [scriptPath, ...commonArgs], {
        stdio: "inherit",
      });

      Promise.all([writePipe.createPipe(), readPipe.createPipe()]).then(
        async () => {
          this.attachListener();
          resolve(null);
        }
      );
    });
  }

  private static getTorrentStateName(state: TorrentState) {
    if (state === TorrentState.CheckingFiles) return GameStatus.CheckingFiles;
    if (state === TorrentState.Downloading) return GameStatus.Downloading;
    if (state === TorrentState.DownloadingMetadata)
      return GameStatus.DownloadingMetadata;
    if (state === TorrentState.Finished) return GameStatus.Finished;
    if (state === TorrentState.Seeding) return GameStatus.Seeding;
    return null;
  }
}
