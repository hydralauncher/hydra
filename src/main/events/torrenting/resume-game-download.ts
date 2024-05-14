import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { In } from "typeorm";
import { DownloadManager } from "@main/services";
import { GameStatus } from "@shared";

const resumeGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      isDeleted: false,
    },
    relations: { repack: true },
  });

  if (!game) return;
  DownloadManager.pauseDownload();

  if (game.status === GameStatus.Paused) {
    const downloadsPath = game.downloadPath ?? (await getDownloadsPath());

    DownloadManager.resumeDownload(gameId);

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

    await gameRepository.update(
      { id: game.id },
      {
        status: GameStatus.Downloading,
        downloadPath: downloadsPath,
      }
    );
  }
};

registerEvent("resumeGameDownload", resumeGameDownload);
