import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { dataSource } from "@main/data-source";
import { DownloadQueue, Game } from "@main/entity";

const pauseGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await dataSource.transaction(async (transactionalEntityManager) => {
    await DownloadManager.pauseDownload();

    await transactionalEntityManager.getRepository(DownloadQueue).delete({
      game: { id: gameId },
    });

    await transactionalEntityManager
      .getRepository(Game)
      .update({ id: gameId }, { status: "paused" });
  });
};

registerEvent("pauseGameDownload", pauseGameDownload);
