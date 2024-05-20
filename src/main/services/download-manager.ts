import Aria2, { StatusResponse } from "aria2";
import { spawn } from "node:child_process";

import { gameRepository, userPreferencesRepository } from "@main/repository";

import path from "node:path";
import { WindowManager } from "./window-manager";
import { RealDebridClient } from "./real-debrid";
import { Notification } from "electron";
import { t } from "i18next";
import { Downloader } from "@shared";
import { DownloadProgress } from "@types";

export class DownloadManager {
  private static downloads = new Map<number, string>();

  private static gid: string | null = null;
  private static gameId: number | null = null;

  private static aria2 = new Aria2({});

  static async connect() {
    const binary = path.join(
      __dirname,
      "..",
      "..",
      "aria2-1.37.0-win-64bit-build1",
      "aria2c"
    );

    spawn(binary, ["--enable-rpc", "--rpc-listen-all"], { stdio: "inherit" });

    await this.aria2.open();
    this.attachListener();
  }

  private static getETA(status: StatusResponse) {
    const remainingBytes =
      Number(status.totalLength) - Number(status.completedLength);
    const speed = Number(status.downloadSpeed);

    if (remainingBytes >= 0 && speed > 0) {
      return (remainingBytes / speed) * 1000;
    }

    return -1;
  }

  static async publishNotification() {
    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });

    if (userPreferences?.downloadNotificationsEnabled && this.gameId) {
      const game = await this.getGame(this.gameId);

      new Notification({
        title: t("download_complete", {
          ns: "notifications",
          lng: userPreferences.language,
        }),
        body: t("game_ready_to_install", {
          ns: "notifications",
          lng: userPreferences.language,
          title: game?.title,
        }),
      }).show();
    }
  }

  private static getFolderName(status: StatusResponse) {
    if (status.bittorrent?.info) return status.bittorrent.info.name;
    return "";
  }

  private static async attachListener() {
    while (true) {
      try {
        if (!this.gid || !this.gameId) {
          continue;
        }

        const status = await this.aria2.call("tellStatus", this.gid);

        const downloadingMetadata =
          status.bittorrent && !status.bittorrent?.info;

        if (status.followedBy?.length) {
          this.gid = status.followedBy[0];
          this.downloads.set(this.gameId, this.gid);
          continue;
        }

        const progress =
          Number(status.completedLength) / Number(status.totalLength);

        await gameRepository.update(
          { id: this.gameId },
          {
            progress:
              isNaN(progress) || downloadingMetadata ? undefined : progress,
            bytesDownloaded: Number(status.completedLength),
            fileSize: Number(status.totalLength),
            status: status.status,
            folderName: this.getFolderName(status),
          }
        );

        const game = await gameRepository.findOne({
          where: { id: this.gameId, isDeleted: false },
          relations: { repack: true },
        });

        if (progress === 1 && game && !downloadingMetadata) {
          await this.publishNotification();
          /*
            Only cancel bittorrent downloads to stop seeding
          */
          if (status.bittorrent) {
            await this.cancelDownload(game.id);
          } else {
            this.clearCurrentDownload();
          }
        }

        if (WindowManager.mainWindow && game) {
          WindowManager.mainWindow.setProgressBar(
            progress === 1 || downloadingMetadata ? -1 : progress,
            { mode: downloadingMetadata ? "indeterminate" : "normal" }
          );

          const payload = {
            progress,
            bytesDownloaded: Number(status.completedLength),
            fileSize: Number(status.totalLength),
            numPeers: Number(status.connections),
            numSeeds: Number(status.numSeeders ?? 0),
            downloadSpeed: Number(status.downloadSpeed),
            timeRemaining: this.getETA(status),
            downloadingMetadata: !!downloadingMetadata,
            game,
          } as DownloadProgress;

          WindowManager.mainWindow.webContents.send(
            "on-download-progress",
            JSON.parse(JSON.stringify(payload))
          );
        }
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  static async getGame(gameId: number) {
    return gameRepository.findOne({
      where: { id: gameId, isDeleted: false },
      relations: {
        repack: true,
      },
    });
  }

  private static clearCurrentDownload() {
    if (this.gameId) {
      this.downloads.delete(this.gameId);
      this.gid = null;
      this.gameId = null;
    }
  }

  static async cancelDownload(gameId: number) {
    const gid = this.downloads.get(gameId);

    if (gid) {
      await this.aria2.call("remove", gid);

      if (this.gid === gid) {
        this.clearCurrentDownload();

        WindowManager.mainWindow?.setProgressBar(-1);
      } else {
        this.downloads.delete(gameId);
      }
    }
  }

  static async pauseDownload() {
    if (this.gid) {
      await this.aria2.call("forcePause", this.gid);
      this.gid = null;
      this.gameId = null;

      WindowManager.mainWindow?.setProgressBar(-1);
    }
  }

  static async resumeDownload(gameId: number) {
    await this.aria2.call("forcePauseAll");

    if (this.downloads.has(gameId)) {
      const gid = this.downloads.get(gameId)!;
      await this.aria2.call("unpause", gid);

      this.gid = gid;
      this.gameId = gameId;
    } else {
      return this.startDownload(gameId);
    }
  }

  static async startDownload(gameId: number) {
    await this.aria2.call("forcePauseAll");

    const game = await this.getGame(gameId)!;

    if (game) {
      const options = {
        dir: game.downloadPath!,
      };

      if (game.downloader === Downloader.RealDebrid) {
        const downloadUrl = decodeURIComponent(
          await RealDebridClient.getDownloadUrl(game)
        );

        this.gid = await this.aria2.call("addUri", [downloadUrl], options);
      } else {
        this.gid = await this.aria2.call(
          "addUri",
          [game.repack.magnet],
          options
        );
      }

      this.gameId = gameId;
      this.downloads.set(gameId, this.gid);
    }
  }
}
