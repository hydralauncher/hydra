import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { In } from "typeorm";
import { DownloadManager, WindowManager } from "@main/services";
import { GameStatus } from "@shared";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  DownloadManager.pauseDownload();

  await gameRepository
    .update(
      {
        id: gameId,
        status: In([
          GameStatus.Downloading,
          GameStatus.DownloadingMetadata,
          GameStatus.CheckingFiles,
        ]),
      },
      { status: GameStatus.Paused }
    )
    .then((result) => {
      if (result.affected) WindowManager.mainWindow?.setProgressBar(-1);
    });
};

registerEvent(pauseGameDownload, {
  name: "pauseGameDownload",
});
