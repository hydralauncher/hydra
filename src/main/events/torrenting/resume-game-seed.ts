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
    },
  });

  if (!game) return;

  await dataSource.transaction(async (transactionalEntityManager) => {
    await transactionalEntityManager
      .getRepository(Game)
      .update({ id: gameId }, { status: "seeding", shouldSeed: true });
  });

  await DownloadManager.resumeDownload(game);
};

registerEvent("resumeGameSeed", resumeGameSeed);
