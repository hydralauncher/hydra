import { getSteamGameIconUrl, writePipe } from "@main/services";
import { gameRepository, repackRepository } from "@main/repository";
import { GameStatus } from "@main/constants";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getImageBase64 } from "@main/helpers";
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

  writePipe.write({ action: "pause" });

  const downloadsPath = downloadPath;

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
        downloadPath: downloadsPath,
        repack: { id: repackId },
      }
    );

    writePipe.write({
      action: "start",
      game_id: game.id,
      magnet: repack.magnet,
      save_path: downloadsPath,
    });

    game.status = GameStatus.DownloadingMetadata;

    writePipe.write({
      action: "start",
      game_id: game.id,
      magnet: repack.magnet,
      save_path: downloadsPath,
    });

    return game;
  } else {
    const iconUrl = await getImageBase64(await getSteamGameIconUrl(objectID));

    const createdGame = await gameRepository.save({
      title,
      iconUrl,
      objectID,
      shop: gameShop,
      status: GameStatus.DownloadingMetadata,
      downloadPath: downloadsPath,
      repack: { id: repackId },
    });

    writePipe.write({
      action: "start",
      game_id: createdGame.id,
      magnet: repack.magnet,
      save_path: downloadsPath,
    });

    const { repack: _, ...rest } = createdGame;

    return rest;
  }
};

registerEvent(startGameDownload, {
  name: "startGameDownload",
});
