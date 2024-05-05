import { t } from "i18next";
import { Notification } from "electron";

import { Game } from "@main/entity";

import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import { WindowManager } from "../window-manager";
import type { TorrentUpdate } from "./torrent.downloader";

import { GameStatus, GameStatusHelper } from "@shared";
import { gameRepository, userPreferencesRepository } from "@main/repository";

interface DownloadStatus {
  numPeers?: number;
  numSeeds?: number;
  downloadSpeed?: number;
  timeRemaining?: number;
}

export class Downloader {
  static getGameProgress(game: Game) {
    if (game.status === GameStatus.CheckingFiles)
      return game.fileVerificationProgress;

    return game.progress;
  }

  static async updateGameProgress(
    gameId: number,
    gameUpdate: QueryDeepPartialEntity<Game>,
    downloadStatus: DownloadStatus
  ) {
    await gameRepository.update({ id: gameId }, gameUpdate);

    const game = await gameRepository.findOne({
      where: { id: gameId, isDeleted: false },
      relations: { repack: true },
    });

    if (game?.progress === 1) {
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
}
