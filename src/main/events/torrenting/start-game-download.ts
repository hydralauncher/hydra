import {
  gameRepository,
  repackRepository,
  userPreferencesRepository,
} from "@main/repository";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getFileBase64, getSteamAppAsset } from "@main/helpers";
import { DownloadManager } from "@main/services";
import { Downloader } from "@shared";
import { stateManager } from "@main/state-manager";
import { Not } from "typeorm";

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

  if (!repack || game?.status === "active") return;

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

    game.status = "active";

    return game;
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
        shop: gameShop,
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

    DownloadManager.startDownload(createdGame.id);

    const { repack: _, ...rest } = createdGame;

    return rest;
  }
};

registerEvent("startGameDownload", startGameDownload);
