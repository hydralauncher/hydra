import { registerEvent } from "../register-event";
import { GameStatus } from "../../constants";
import {gameRepository, userPreferencesRepository} from "../../repository";
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

  writePipe.write({ action: "pause" });

  if (game.status === GameStatus.Paused) {
    const downloadsPath = game.downloadPath ?? (await getDownloadsPath());

    const userPreferences = await userPreferencesRepository.findOne({
      where: { id: 1 },
    });

    writePipe.write({
      action: "start",
      game_id: gameId,
      magnet: game.repack.magnet,
      save_path: downloadsPath,
      debrid_enabled: userPreferences?.debridServicesEnabled ?? false,
      debrid_api_key: userPreferences?.realDebridAPIKey ?? "",
    });

    await gameRepository.update(
      {
        status: In([
          GameStatus.Downloading,
          GameStatus.DownloadingMetadata,
          GameStatus.CheckingFiles,
          GameStatus.DebridCaching,
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
