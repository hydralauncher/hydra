import { getSteamGameIconUrl } from "@main/services";
import {
  gameRepository,
  repackRepository,
  userPreferencesRepository,
} from "@main/repository";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getFileBase64 } from "@main/helpers";
import { In } from "typeorm";
import { DownloadManager } from "@main/services";
import { Downloader, GameStatus } from "@shared";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  repackId: number,
  objectID: string,
  title: string,
  gameShop: GameShop,
  downloadPath: string
) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  const downloader = userPreferences?.realDebridApiToken
    ? Downloader.RealDebrid
    : Downloader.Torrent;

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

  if (!repack || game?.status === GameStatus.Downloading) return;
  DownloadManager.pauseDownload();

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
        downloader,
        repack: { id: repackId },
        isDeleted: false,
      }
    );

    DownloadManager.downloadGame(game.id);

    game.status = GameStatus.DownloadingMetadata;

    return game;
  } else {
    const iconUrl = await getFileBase64(await getSteamGameIconUrl(objectID));

    const createdGame = await gameRepository.save({
      title,
      iconUrl,
      objectID,
      downloader,
      shop: gameShop,
      status: GameStatus.Downloading,
      downloadPath,
      repack: { id: repackId },
    });

    DownloadManager.downloadGame(createdGame.id);

    const { repack: _, ...rest } = createdGame;

    return rest;
  }
};

registerEvent(startGameDownload, {
  name: "startGameDownload",
});
