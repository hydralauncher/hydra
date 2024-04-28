import { WindowManager, writePipe } from "@main/services";

import { registerEvent } from "../register-event";
import { GameStatus } from "../../constants";
import { gameRepository } from "../../repository";
import { In } from "typeorm";

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
          GameStatus.DebridCaching,
        ]),
      },
      { status: GameStatus.Paused }
    )
    .then((result) => {
      if (result.affected) {
        writePipe.write({ action: "pause" });
        WindowManager.mainWindow?.setProgressBar(-1);
      }
    });
};

registerEvent(pauseGameDownload, {
  name: "pauseGameDownload",
});
