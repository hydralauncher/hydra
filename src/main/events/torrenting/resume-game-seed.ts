import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { DownloadManager } from "@main/services";
import { Downloader } from "@shared";

const resumeGameSeed = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      isDeleted: false,
      downloader: Downloader.Torrent,
      progress: 1,
    },
  });

  if (!game) return;

  await gameRepository.update(gameId, {
    status: "seeding",
    shouldSeed: true,
  });

  await DownloadManager.resumeSeeding(game);
};

registerEvent("resumeGameSeed", resumeGameSeed);
