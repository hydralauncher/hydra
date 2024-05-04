import { WindowManager } from "@main/services";

import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { In } from "typeorm";
import { Downloader } from "@main/services/downloaders/downloader";
import { GameStatus } from "@globals";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
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
      if (result.affected) {
        Downloader.pauseDownload();
        WindowManager.mainWindow?.setProgressBar(-1);
      }
    });
};

registerEvent(pauseGameDownload, {
  name: "pauseGameDownload",
});
