import { Downloader } from "@shared";
import { WindowManager } from "../window-manager";
import { publishDownloadCompleteNotification } from "../notifications";
import type { Download, DownloadProgress, UserPreferences } from "@types";
import { GofileApi, QiwiApi, DatanodesApi } from "../hosters";
import { PythonRPC } from "../python-rpc";
import {
  LibtorrentPayload,
  LibtorrentStatus,
  PauseDownloadPayload,
} from "./types";
import { calculateETA, getDirSize } from "./helpers";
import { RealDebridClient } from "./real-debrid";
import path from "path";
import { logger } from "../logger";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { sortBy } from "lodash-es";

export class DownloadManager {
  private static downloadingGameId: string | null = null;

  public static async startRPC(
    download?: Download,
    downloadsToSeed?: Download[]
  ) {
    PythonRPC.spawn(
      download?.status === "active"
        ? await this.getDownloadPayload(download).catch(() => undefined)
        : undefined,
      downloadsToSeed?.map((download) => ({
        game_id: `${download.shop}-${download.objectId}`,
        url: download.uri!,
        save_path: download.downloadPath!,
      }))
    );

    if (download) {
      this.downloadingGameId = `${download.shop}-${download.objectId}`;
    }
  }

  private static async getDownloadStatus() {
    const response = await PythonRPC.rpc.get<LibtorrentPayload | null>(
      "/status"
    );
    if (response.data === null || !this.downloadingGameId) return null;
    const downloadId = this.downloadingGameId;

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

      const download = await downloadsSublevel.get(downloadId);

      if (!isDownloadingMetadata && !isCheckingFiles) {
        if (!download) return null;

        await downloadsSublevel.put(downloadId, {
          ...download,
          bytesDownloaded,
          fileSize,
          progress,
          folderName,
          status: "active",
        });
      }

      return {
        numPeers,
        numSeeds,
        downloadSpeed,
        timeRemaining: calculateETA(fileSize, bytesDownloaded, downloadSpeed),
        isDownloadingMetadata,
        isCheckingFiles,
        progress,
        gameId: downloadId,
        download,
      } as DownloadProgress;
    } catch (err) {
      return null;
    }
  }

  public static async watchDownloads() {
    const status = await this.getDownloadStatus();

    if (status) {
      const { gameId, progress } = status;

      const [download, game] = await Promise.all([
        downloadsSublevel.get(gameId),
        gamesSublevel.get(gameId),
      ]);

      if (!download || !game) return;

      const userPreferences = await db.get<string, UserPreferences>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      if (WindowManager.mainWindow && download) {
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

      if (progress === 1 && download) {
        publishDownloadCompleteNotification(game);

        if (
          userPreferences?.seedAfterDownloadComplete &&
          download.downloader === Downloader.Torrent
        ) {
          downloadsSublevel.put(gameId, {
            ...download,
            status: "seeding",
            shouldSeed: true,
          });
        } else {
          downloadsSublevel.put(gameId, {
            ...download,
            status: "complete",
            shouldSeed: false,
          });

          this.cancelDownload(gameId);
        }

        const downloads = await downloadsSublevel
          .values()
          .all()
          .then((games) => {
            return sortBy(games, "timestamp", "DESC");
          });

        const [nextItemOnQueue] = downloads;

        if (nextItemOnQueue) {
          this.resumeDownload(nextItemOnQueue);
        } else {
          this.downloadingGameId = null;
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
      const download = await downloadsSublevel.get(status.gameId);

      if (!download) return;

      const totalSize = await getDirSize(
        path.join(download.downloadPath!, status.folderName)
      );

      if (totalSize < status.fileSize) {
        await this.cancelDownload(status.gameId);

        await downloadsSublevel.put(status.gameId, {
          ...download,
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

  static async resumeDownload(download: Download) {
    return this.startDownload(download);
  }

  static async cancelDownload(downloadKey = this.downloadingGameId!) {
    await PythonRPC.rpc.post("/action", {
      action: "cancel",
      game_id: downloadKey,
    });

    WindowManager.mainWindow?.setProgressBar(-1);
    if (downloadKey === this.downloadingGameId) {
      this.downloadingGameId = null;
    }
  }

  static async resumeSeeding(download: Download) {
    await PythonRPC.rpc.post("/action", {
      action: "resume_seeding",
      game_id: levelKeys.game(download.shop, download.objectId),
      url: download.uri,
      save_path: download.downloadPath,
    });
  }

  static async pauseSeeding(downloadKey: string) {
    await PythonRPC.rpc.post("/action", {
      action: "pause_seeding",
      game_id: downloadKey,
    });
  }

  private static async getDownloadPayload(download: Download) {
    const downloadId = levelKeys.game(download.shop, download.objectId);

    switch (download.downloader) {
      case Downloader.Gofile: {
        const id = download.uri!.split("/").pop();
        const token = await GofileApi.authorize();
        const downloadLink = await GofileApi.getDownloadLink(id!);

        return {
          action: "start",
          game_id: downloadId,
          url: downloadLink,
          save_path: download.downloadPath!,
          header: `Cookie: accountToken=${token}`,
        };
      }
      case Downloader.PixelDrain: {
        const id = download.uri!.split("/").pop();
        return {
          action: "start",
          game_id: downloadId,
          url: `https://pixeldrain.com/api/file/${id}?download`,
          save_path: download.downloadPath!,
        };
      }
      case Downloader.Qiwi: {
        const downloadUrl = await QiwiApi.getDownloadUrl(download.uri!);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath!,
        };
      }
      case Downloader.Datanodes: {
        const downloadUrl = await DatanodesApi.getDownloadUrl(download.uri!);
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl,
          save_path: download.downloadPath!,
        };
      }
      case Downloader.Torrent:
        return {
          action: "start",
          game_id: downloadId,
          url: download.uri!,
          save_path: download.downloadPath!,
        };
      case Downloader.RealDebrid: {
        const downloadUrl = await RealDebridClient.getDownloadUrl(
          download.uri!
        );
        return {
          action: "start",
          game_id: downloadId,
          url: downloadUrl!,
          save_path: download.downloadPath!,
        };
      }
    }
  }

  static async startDownload(download: Download) {
    const payload = await this.getDownloadPayload(download);
    await PythonRPC.rpc.post("/action", payload);
    this.downloadingGameId = levelKeys.game(download.shop, download.objectId);
  }
}
