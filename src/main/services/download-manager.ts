import Aria2, { StatusResponse } from "aria2";

import { gameRepository, userPreferencesRepository } from "@main/repository";

import { WindowManager } from "./window-manager";
import { RealDebridClient } from "./real-debrid";
import { Notification } from "electron";
import { t } from "i18next";
import { Downloader } from "@shared";
import { DownloadProgress } from "@types";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { Game } from "@main/entity";
import { startAria2 } from "./aria2";

export class DownloadManager {
  private static downloads = new Map<number, string>();

  private static connected = false;
  private static gid: string | null = null;
  private static game: Game | null = null;
  private static realDebridTorrentId: string | null = null;

  private static aria2 = new Aria2({});

  private static async connect() {
    await startAria2();
    await this.aria2.open();
    this.connected = true;
  }

  private static getETA(
    totalLength: number,
    completedLength: number,
    speed: number
  ) {
    const remainingBytes = totalLength - completedLength;

    if (remainingBytes >= 0 && speed > 0) {
      return (remainingBytes / speed) * 1000;
    }

    return -1;
  }

  static async publishNotification() {
    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });

    if (userPreferences?.downloadNotificationsEnabled && this.game) {
      new Notification({
        title: t("download_complete", {
          ns: "notifications",
          lng: userPreferences.language,
        }),
        body: t("game_ready_to_install", {
          ns: "notifications",
          lng: userPreferences.language,
          title: this.game.title,
        }),
      }).show();
    }
  }

  private static getFolderName(status: StatusResponse) {
    if (status.bittorrent?.info) return status.bittorrent.info.name;
    return "";
  }

  private static async getRealDebridDownloadUrl() {
    if (this.realDebridTorrentId) {
      const torrentInfo = await RealDebridClient.getTorrentInfo(
        this.realDebridTorrentId
      );

      const { status, links } = torrentInfo;

      if (status === "waiting_files_selection") {
        await RealDebridClient.selectAllFiles(this.realDebridTorrentId);
        return null;
      }

      if (status === "downloaded") {
        const [link] = links;
        const { download } = await RealDebridClient.unrestrictLink(link);
        return decodeURIComponent(download);
      }

      if (WindowManager.mainWindow) {
        const progress = torrentInfo.progress / 100;
        const totalDownloaded = progress * torrentInfo.bytes;

        WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);

        const payload = {
          numPeers: 0,
          numSeeds: torrentInfo.seeders,
          downloadSpeed: torrentInfo.speed,
          timeRemaining: this.getETA(
            torrentInfo.bytes,
            totalDownloaded,
            torrentInfo.speed
          ),
          isDownloadingMetadata: status === "magnet_conversion",
          game: {
            ...this.game,
            bytesDownloaded: progress * torrentInfo.bytes,
            progress,
          },
        } as DownloadProgress;

        WindowManager.mainWindow.webContents.send(
          "on-download-progress",
          JSON.parse(JSON.stringify(payload))
        );
      }
    }

    return null;
  }

  public static async watchDownloads() {
    if (!this.game) return;

    if (!this.gid && this.realDebridTorrentId) {
      const options = { dir: this.game.downloadPath! };
      const downloadUrl = await this.getRealDebridDownloadUrl();

      if (downloadUrl) {
        this.gid = await this.aria2.call("addUri", [downloadUrl], options);
        this.downloads.set(this.game.id, this.gid);
        this.realDebridTorrentId = null;
      }
    }

    if (!this.gid) return;

    const status = await this.aria2.call("tellStatus", this.gid);

    const isDownloadingMetadata = status.bittorrent && !status.bittorrent?.info;

    if (status.followedBy?.length) {
      this.gid = status.followedBy[0];
      this.downloads.set(this.game.id, this.gid);
      return;
    }

    const progress =
      Number(status.completedLength) / Number(status.totalLength);

    if (!isDownloadingMetadata) {
      const update: QueryDeepPartialEntity<Game> = {
        bytesDownloaded: Number(status.completedLength),
        fileSize: Number(status.totalLength),
        status: status.status,
      };

      if (!isNaN(progress)) update.progress = progress;

      await gameRepository.update(
        { id: this.game.id },
        {
          ...update,
          status: status.status,
          folderName: this.getFolderName(status),
        }
      );
    }

    const game = await gameRepository.findOne({
      where: { id: this.game.id, isDeleted: false },
      relations: { repack: true },
    });

    if (progress === 1 && this.game && !isDownloadingMetadata) {
      await this.publishNotification();

      /*
        Only cancel bittorrent downloads to stop seeding
      */
      if (status.bittorrent) {
        await this.cancelDownload(this.game.id);
      } else {
        this.clearCurrentDownload();
      }
    }

    if (WindowManager.mainWindow && game) {
      if (!isNaN(progress))
        WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);

      const payload = {
        numPeers: Number(status.connections),
        numSeeds: Number(status.numSeeders ?? 0),
        downloadSpeed: Number(status.downloadSpeed),
        timeRemaining: this.getETA(
          Number(status.totalLength),
          Number(status.completedLength),
          Number(status.downloadSpeed)
        ),
        isDownloadingMetadata: !!isDownloadingMetadata,
        game,
      } as DownloadProgress;

      WindowManager.mainWindow.webContents.send(
        "on-download-progress",
        JSON.parse(JSON.stringify(payload))
      );
    }
  }

  private static clearCurrentDownload() {
    if (this.game) {
      this.downloads.delete(this.game.id);
      this.gid = null;
      this.game = null;
      this.realDebridTorrentId = null;
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
    }

    this.game = null;
    this.realDebridTorrentId = null;

    WindowManager.mainWindow?.setProgressBar(-1);
  }

  static async resumeDownload(game: Game) {
    if (this.downloads.has(game.id)) {
      const gid = this.downloads.get(game.id)!;
      await this.aria2.call("unpause", gid);

      this.gid = gid;
      this.game = game;
      this.realDebridTorrentId = null;
    } else {
      return this.startDownload(game);
    }
  }

  static async startDownload(game: Game) {
    if (!this.connected) await this.connect();

    const options = {
      dir: game.downloadPath!,
    };

    if (game.downloader === Downloader.RealDebrid) {
      this.realDebridTorrentId = await RealDebridClient.getTorrentId(
        game!.repack.magnet
      );
    } else {
      this.gid = await this.aria2.call("addUri", [game.repack.magnet], options);
      this.downloads.set(game.id, this.gid);
    }

    this.game = game;
  }
}
