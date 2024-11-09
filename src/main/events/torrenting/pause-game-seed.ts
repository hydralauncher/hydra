import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { dataSource } from "@main/data-source";
import { Game } from "@main/entity";

const pauseGameSeed = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await dataSource.transaction(async (transactionalEntityManager) => {
    await transactionalEntityManager
      .getRepository(Game)
      .update({ id: gameId }, { status: "complete", shouldSeed: false });
  });

  await DownloadManager.pauseSeeding(gameId);
};

registerEvent("pauseGameSeed", pauseGameSeed);
