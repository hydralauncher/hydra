import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { dataSource } from "@main/data-source";
import { Game } from "@main/entity";
import { gameRepository } from "@main/repository";

const pauseGameSeed = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOneBy({ id: gameId });

  if (game?.status !== "seeding") return;

  await dataSource.transaction(async (transactionalEntityManager) => {
    await transactionalEntityManager
      .getRepository(Game)
      .update({ id: gameId }, { status: "complete", shouldSeed: false });
  });

  await DownloadManager.pauseSeeding(gameId);
};

registerEvent("pauseGameSeed", pauseGameSeed);
