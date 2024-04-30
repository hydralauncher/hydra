import { Game, Repack } from "@main/entity";
import { writePipe } from "../fifo";
import { gameRepository, userPreferencesRepository } from "@main/repository";
import { RealDebridClient } from "./real-debrid";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { t } from "i18next";
import { Notification } from "electron";
import { WindowManager } from "../window-manager";
import { TorrentUpdate } from "./torrent-client";
import { HTTPDownloader } from "./http-downloader";
import { Unrar } from "../unrar";
import { GameStatus } from "@globals";
import path from "node:path";

interface DownloadStatus {
  numPeers: number;
  numSeeds: number;
  downloadSpeed: number;
  timeRemaining: number;
}

export class Downloader {
  private static lastHttpDownloader: HTTPDownloader | null = null;

  static async usesRealDebrid() {
    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });
    return userPreferences!.realDebridApiToken !== null;
  }

  static async cancelDownload() {
    if (!(await this.usesRealDebrid())) {
      writePipe.write({ action: "cancel" });
    } else {
      if (this.lastHttpDownloader) {
        this.lastHttpDownloader.cancel();
      }
    }
  }

  static async pauseDownload() {
    if (!(await this.usesRealDebrid())) {
      writePipe.write({ action: "pause" });
    } else {
      if (this.lastHttpDownloader) {
        this.lastHttpDownloader.pause();
      }
    }
  }

  static async resumeDownload() {
    if (!(await this.usesRealDebrid())) {
      writePipe.write({ action: "pause" });
    } else {
      if (this.lastHttpDownloader) {
        this.lastHttpDownloader.resume();
      }
    }
  }

  static async downloadGame(game: Game, repack: Repack) {
    if (!(await this.usesRealDebrid())) {
      writePipe.write({
        action: "start",
        game_id: game.id,
        magnet: repack.magnet,
        save_path: game.downloadPath,
      });
    } else {
      try {
        // Lets try first to find the torrent on RealDebrid
        const torrents = await RealDebridClient.getAllTorrents();
        const hash = RealDebridClient.extractSHA1FromMagnet(repack.magnet);
        let torrent = torrents.find((t) => t.hash === hash);

        if (!torrent) {
          // Torrent is missing, lets add it
          const magnet = await RealDebridClient.addMagnet(repack.magnet);
          if (magnet && magnet.id) {
            await RealDebridClient.selectAllFiles(magnet.id);
            torrent = await RealDebridClient.getInfo(magnet.id);
          }
        }

        if (torrent) {
          const { links } = torrent;
          const { download } = await RealDebridClient.unrestrictLink(links[0]);
          this.lastHttpDownloader = new HTTPDownloader();
          this.lastHttpDownloader.download(
            download,
            game.downloadPath!,
            game.id
          );
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  static async updateGameProgress(
    gameId: number,
    gameUpdate: QueryDeepPartialEntity<Game>,
    downloadStatus: DownloadStatus
  ) {
    await gameRepository.update({ id: gameId }, gameUpdate);

    const game = await gameRepository.findOne({
      where: { id: gameId },
      relations: { repack: true },
    });

    if (
      gameUpdate.progress === 1 &&
      gameUpdate.status !== GameStatus.Decompressing
    ) {
      const userPreferences = await userPreferencesRepository.findOne({
        where: { id: 1 },
      });

      if (userPreferences?.downloadNotificationsEnabled) {
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

    if (
      game &&
      gameUpdate.decompressionProgress === 0 &&
      gameUpdate.status === GameStatus.Decompressing
    ) {
      const unrar = await Unrar.fromFilePath(
        game.rarPath!,
        path.join(game.downloadPath!, game.folderName!)
      );
      unrar.extract();
      this.updateGameProgress(
        gameId,
        {
          decompressionProgress: 1,
          status: GameStatus.Finished,
        },
        downloadStatus
      );
    }

    if (WindowManager.mainWindow && game) {
      const progress = this.getGameProgress(game);
      WindowManager.mainWindow.setProgressBar(progress === 1 ? -1 : progress);

      WindowManager.mainWindow.webContents.send(
        "on-download-progress",
        JSON.parse(
          JSON.stringify({
            ...({
              progress: gameUpdate.progress,
              bytesDownloaded: gameUpdate.bytesDownloaded,
              fileSize: gameUpdate.fileSize,
              gameId,
              numPeers: downloadStatus.numPeers,
              numSeeds: downloadStatus.numSeeds,
              downloadSpeed: downloadStatus.downloadSpeed,
              timeRemaining: downloadStatus.timeRemaining,
            } as TorrentUpdate),
            game,
          })
        )
      );
    }
  }

  static getGameProgress(game: Game) {
    if (game.status === GameStatus.CheckingFiles)
      return game.fileVerificationProgress;
    if (game.status === GameStatus.Decompressing)
      return game.decompressionProgress;
    return game.progress;
  }
}
