import {
  downloadQueueRepository,
  gameRepository,
  repackRepository,
} from "@main/repository";

import { registerEvent } from "../register-event";

import type { StartGameDownloadPayload } from "@types";
import { getFileBase64, getSteamAppAsset } from "@main/helpers";
import { DownloadManager } from "@main/services";

import { Not } from "typeorm";
import { steamGamesWorker } from "@main/workers";
import { createGame } from "@main/services/library-sync";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const { repackId, objectID, title, shop, downloadPath, downloader, uri } =
    payload;

  const [game, repack] = await Promise.all([
    gameRepository.findOne({
      where: {
        objectID,
        shop,
      },
    }),
    repackRepository.findOne({
      where: {
        id: repackId,
      },
    }),
  ]);

  if (!repack) return;

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
    const steamGame = await steamGamesWorker.run(Number(objectID), {
      name: "getById",
    });

    const iconUrl = steamGame?.clientIcon
      ? getSteamAppAsset("icon", objectID, steamGame.clientIcon)
      : null;

    await gameRepository
      .insert({
        title,
        iconUrl,
        objectID,
        downloader,
        shop,
        status: "active",
        downloadPath,
        uri,
      })
      .then((result) => {
        if (iconUrl) {
          getFileBase64(iconUrl).then((base64) =>
            gameRepository.update({ objectID }, { iconUrl: base64 })
          );
        }

        return result;
      });
  }

  const updatedGame = await gameRepository.findOne({
    where: {
      objectID,
    },
  });

  createGame(updatedGame!);

  await downloadQueueRepository.delete({ game: { id: updatedGame!.id } });
  await downloadQueueRepository.insert({ game: { id: updatedGame!.id } });

  await DownloadManager.startDownload(updatedGame!);
};

registerEvent("startGameDownload", startGameDownload);
