import { gameRepository, repackRepository } from "@main/repository";

import { registerEvent } from "../register-event";

import type { StartGameDownloadPayload } from "@types";
import { getFileBase64, getSteamAppAsset } from "@main/helpers";
import { DownloadManager } from "@main/services";
import { stateManager } from "@main/state-manager";
import { Not } from "typeorm";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const { repackId, objectID, title, shop, downloadPath, downloader } = payload;

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

  if (!repack || game?.status === "active") return;

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
        downloadPath,
        downloader,
        repack: { id: repackId },
        isDeleted: false,
      }
    );

    await DownloadManager.startDownload(game.id);

    return { ...game, stauts: "active" };
  } else {
    const steamGame = stateManager
      .getValue("steamGames")
      .find((game) => game.id === Number(objectID));

    const iconUrl = steamGame?.clientIcon
      ? getSteamAppAsset("icon", objectID, steamGame.clientIcon)
      : null;

    const createdGame = await gameRepository
      .save({
        title,
        iconUrl,
        objectID,
        downloader,
        shop,
        status: "active",
        downloadPath,
        repack: { id: repackId },
      })
      .then((result) => {
        if (iconUrl) {
          getFileBase64(iconUrl).then((base64) =>
            gameRepository.update({ objectID }, { iconUrl: base64 })
          );
        }

        return result;
      });

    await DownloadManager.startDownload(createdGame.id);

    return createdGame;
  }
};

registerEvent("startGameDownload", startGameDownload);
