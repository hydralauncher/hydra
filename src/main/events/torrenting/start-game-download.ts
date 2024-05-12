import { getSteamGameIconUrl, writePipe } from "@main/services";
import { gameRepository, repackRepository } from "@main/repository";
import { GameStatus } from "@main/constants";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getFileBase64 } from "@main/helpers";
import { In } from "typeorm";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  repackId: number,
  objectID: string,
  title: string,
  gameShop: GameShop,
  downloadPath: string
) => {
  const [game, repack] = await Promise.all([
    gameRepository.findOne({
      where: {
        objectID,
      },
    }),
    repackRepository.findOne({
      where: {
        id: repackId,
      },
    }),
  ]);

  if (!repack) return;

  if (game?.status === GameStatus.Downloading) {
    return;
  }

  const hasGameInDownloading = await gameRepository.exists({
    where: {
      status: In([
        GameStatus.Downloading,
        GameStatus.DownloadingMetadata,
        GameStatus.CheckingFiles,
      ]),
    },
  });

  if (game) {
    await gameRepository.update(
      {
        id: game.id,
      },
      {
        status: hasGameInDownloading ? GameStatus.Queue : GameStatus.DownloadingMetadata,
        downloadPath: downloadPath == "" || downloadPath == null ? game.downloadPath : downloadPath,
        repack: { id: repackId },
        isDeleted: false,
      }
    );

    if(!hasGameInDownloading){
      writePipe.write({
        action: "start",
        game_id: game.id,
        magnet: repack.magnet,
        save_path: downloadPath,
      });

      game.status = GameStatus.DownloadingMetadata;
    }

    return game;
  } else {
    const iconUrl = await getFileBase64(await getSteamGameIconUrl(objectID));

    const createdGame = await gameRepository.save({
      title,
      iconUrl,
      objectID,
      shop: gameShop,
      status: hasGameInDownloading ? GameStatus.Queue : GameStatus.DownloadingMetadata,
      downloadPath: downloadPath,
      repack: { id: repackId },
    });

    if(!hasGameInDownloading){
      writePipe.write({
        action: "start",
        game_id: createdGame.id,
        magnet: repack.magnet,
        save_path: downloadPath,
      });
    }
    
    const { repack: _, ...rest } = createdGame;

    return rest;
  }
};

const gameDownloadQueueMonitor = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  const nextGame = await gameRepository.findOne({
    where: { 
      status: GameStatus.Queue
    },
    relations: { repack: true }
  });

  const hasGameInDownloading = await gameRepository.exists({
    where: {
      status: In([
        GameStatus.Downloading,
        GameStatus.DownloadingMetadata,
        GameStatus.CheckingFiles,
      ]),
    },
  });

  if(nextGame != null && !hasGameInDownloading){
    await startGameDownload(_event, nextGame.repack.id, nextGame.objectID, nextGame.title, nextGame.shop, nextGame.downloadPath ?? "");
  }
};

registerEvent(startGameDownload, {
  name: "startGameDownload",
});

registerEvent(gameDownloadQueueMonitor, {
  name: "gameDownloadQueueMonitor",
});
