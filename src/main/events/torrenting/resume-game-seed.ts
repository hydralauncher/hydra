import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";
import { DownloadManager } from "@main/services";

const resumeGameSeed = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      isDeleted: false,
      downloader: 1,
      progress: 1,
    },
  });

  if (!game) return;

  await gameRepository.update(gameId, {
    status: "seeding",
    shouldSeed: true,
  });

  await DownloadManager.startDownload(game);
};

registerEvent("resumeGameSeed", resumeGameSeed);
