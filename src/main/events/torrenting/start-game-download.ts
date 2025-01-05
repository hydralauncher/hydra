import { registerEvent } from "../register-event";
import type { StartGameDownloadPayload } from "@types";
import { DownloadManager, HydraApi } from "@main/services";

import { Not } from "typeorm";
import { steamGamesWorker } from "@main/workers";
import { createGame } from "@main/services/library-sync";
import { steamUrlBuilder } from "@shared";
import { dataSource } from "@main/data-source";
import { DownloadQueue, Game } from "@main/entity";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const { objectId, title, shop, downloadPath, downloader, uri } = payload;

  return dataSource.transaction(async (transactionalEntityManager) => {
    const gameRepository = transactionalEntityManager.getRepository(Game);
    const downloadQueueRepository =
      transactionalEntityManager.getRepository(DownloadQueue);

    const game = await gameRepository.findOne({
      where: {
        objectID: objectId,
        shop,
      },
    });

    await DownloadManager.pauseDownload();

    await gameRepository.update(
      { status: "active", progress: Not(1) },
      { status: "paused" }
    );

    if (game) {
      await gameRepository.update(
        {
          id: game.id,
        },
        {
          status: "active",
          progress: 0,
          bytesDownloaded: 0,
          downloadPath,
          downloader,
          uri,
          isDeleted: false,
        }
      );
    } else {
      const steamGame = await steamGamesWorker.run(Number(objectId), {
        name: "getById",
      });

      const iconUrl = steamGame?.clientIcon
        ? steamUrlBuilder.icon(objectId, steamGame.clientIcon)
        : null;

      await gameRepository.insert({
        title,
        iconUrl,
        objectID: objectId,
        downloader,
        shop,
        status: "active",
        downloadPath,
        uri,
      });
    }

    const updatedGame = await gameRepository.findOne({
      where: {
        objectID: objectId,
      },
    });

    await DownloadManager.cancelDownload(updatedGame!.id);
    await DownloadManager.startDownload(updatedGame!);

    await downloadQueueRepository.delete({ game: { id: updatedGame!.id } });
    await downloadQueueRepository.insert({ game: { id: updatedGame!.id } });

    await Promise.all([
      createGame(updatedGame!).catch(() => {}),
      HydraApi.post(
        "/games/download",
        {
          objectId: updatedGame!.objectID,
          shop: updatedGame!.shop,
        },
        { needsAuth: false }
      ).catch(() => {}),
    ]);
  });
};

registerEvent("startGameDownload", startGameDownload);
