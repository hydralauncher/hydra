import { getSteamGameIconUrl, writePipe } from "@main/services";
import { gameRepository, repackRepository } from "@main/repository";
import { GameStatus } from "@main/constants";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { getImageBase64 } from "@main/helpers";
import { In } from "typeorm";
import validatePath from "./helpers/validate-path";
import { dialog } from "electron";
import { t } from "i18next";

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  repackId: number,
  objectID: string,
  title: string,
  gameShop: GameShop
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

  const downloadsPath = game?.downloadPath ?? (await getDownloadsPath());
  const error = validatePath(downloadsPath);
  if (error) {
    dialog.showErrorBox(
      t("error_title_modal", {
        ns: "settings",
        lng: "en",
      }),
      `${t("error_modal_download", {
        ns: "settings",
        lng: "en",
      })}${error instanceof Error ? "\n" + error.message : ""}`
    );
    return;
  }

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
