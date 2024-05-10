import { registerEvent } from "../register-event";
import { GameStatus } from "../../constants";
import { gameRepository } from "../../repository";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { In } from "typeorm";
import { writePipe } from "@main/services";

const resumeGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
    },
    relations: { repack: true },
  });

  if (!game) return;

  let hasGameInDownloading = await gameRepository.exists({
    where: {
      status: In([
        GameStatus.Downloading,
        GameStatus.DownloadingMetadata,
        GameStatus.CheckingFiles,
      ]),
    },
  });

  if(game.status === GameStatus.Queue && hasGameInDownloading){
    writePipe.write({ action: "pause" });

    await gameRepository.update(
      {
        status: In([
          GameStatus.Downloading,
          GameStatus.DownloadingMetadata,
          GameStatus.CheckingFiles,
        ]),
      },
      { status: GameStatus.Queue }
    );

    hasGameInDownloading = false;
  }

  if (game.status === GameStatus.Paused || game.status === GameStatus.Queue) {
    const downloadsPath = game.downloadPath ?? (await getDownloadsPath());

    await gameRepository.update(
      { id: game.id },
      {
        status: hasGameInDownloading ? GameStatus.Queue : GameStatus.DownloadingMetadata,
        downloadPath: downloadsPath,
      }
    );

    if(!hasGameInDownloading){
      writePipe.write({
        action: "start",
        game_id: gameId,
        magnet: game.repack.magnet,
        save_path: downloadsPath,
      });
    }
  }
};

registerEvent(resumeGameDownload, {
  name: "resumeGameDownload",
});
