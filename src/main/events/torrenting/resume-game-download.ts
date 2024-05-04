import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { In } from "typeorm";
import { Downloader } from "@main/services/downloaders/downloader";
import { GameStatus } from "@globals";

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

  Downloader.resumeDownload();

  if (game.status === GameStatus.Paused) {
    const downloadsPath = game.downloadPath ?? (await getDownloadsPath());

    Downloader.downloadGame(game, game.repack);

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
        status: GameStatus.DownloadingMetadata,
        downloadPath: downloadsPath,
      }
    );
  }
};

registerEvent(resumeGameDownload, {
  name: "resumeGameDownload",
});
