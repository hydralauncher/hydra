import { getSteamGameIconUrl } from "@main/services";
import { gameRepository, repackRepository } from "@main/repository";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getFileBase64 } from "@main/helpers";
import { In } from "typeorm";
import { Downloader } from "@main/services/downloaders/downloader";
import { GameStatus } from "@globals";

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

  Downloader.pauseDownload();

  await gameRepository.update(
    {
      status: In([
        GameStatus.Downloading,
        GameStatus.DownloadingMetadata,
        GameStatus.CheckingFiles,
      ]),
    },
    { status: GameStatus.Paused }
  );

  if (game) {
    await gameRepository.update(
      {
        id: game.id,
      },
      {
        status: GameStatus.DownloadingMetadata,
        downloadPath: downloadPath,
        repack: { id: repackId },
        isDeleted: false,
      }
    );

    Downloader.downloadGame(game, repack);

    game.status = GameStatus.DownloadingMetadata;

    return game;
  } else {
    const iconUrl = await getFileBase64(await getSteamGameIconUrl(objectID));

    const createdGame = await gameRepository.save({
      title,
      iconUrl,
      objectID,
      shop: gameShop,
      status: GameStatus.DownloadingMetadata,
      downloadPath: downloadPath,
      repack: { id: repackId },
    });

    Downloader.downloadGame(createdGame, repack);

    const { repack: _, ...rest } = createdGame;

    return rest;
  }
};

registerEvent(startGameDownload, {
  name: "startGameDownload",
});
