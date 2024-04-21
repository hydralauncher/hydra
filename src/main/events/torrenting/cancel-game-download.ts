import { GameStatus } from "@main/constants";
import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { WindowManager, writePipe } from "@main/services";

import { In } from "typeorm";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      status: In([
        GameStatus.Downloading,
        GameStatus.DownloadingMetadata,
        GameStatus.CheckingFiles,
        GameStatus.Paused,
        GameStatus.Seeding,
      ]),
    },
  });

  if (!game) return;

  gameRepository
    .update(
      {
        id: game.id,
      },
      {
        status: GameStatus.Cancelled,
        downloadPath: null,
        bytesDownloaded: 0,
        progress: 0,
      }
    )
    .then((result) => {
      if (
        game.status !== GameStatus.Paused &&
        game.status !== GameStatus.Seeding
      ) {
        writePipe.write({ action: "cancel" });
        if (result.affected) WindowManager.mainWindow.setProgressBar(-1);
      }
    });
};

registerEvent(cancelGameDownload, {
  name: "cancelGameDownload",
});
