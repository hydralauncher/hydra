import { registerEvent } from "../register-event";
import { DownloadManager } from "@main/services";
import { gameRepository } from "@main/repository";

const pauseGameSeed = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await gameRepository.update(gameId, {
    status: "complete",
    shouldSeed: false,
  });

  await DownloadManager.pauseSeeding(gameId);
};

registerEvent("pauseGameSeed", pauseGameSeed);
