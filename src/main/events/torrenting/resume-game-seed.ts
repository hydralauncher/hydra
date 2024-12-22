import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";

import { DownloadManager } from "@main/services";
import { dataSource } from "@main/data-source";
import { Game } from "@main/entity";

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

  await dataSource
    .getRepository(Game)
    .update({ id: gameId }, { status: "seeding", shouldSeed: true });

  await DownloadManager.startDownload(game);
};

registerEvent("resumeGameSeed", resumeGameSeed);
