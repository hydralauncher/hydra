import { registerEvent } from "../register-event";

import { DownloadManager } from "@main/services";
import { dataSource } from "@main/data-source";
import { DownloadQueue, Game } from "@main/entity";

const cancelGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  await dataSource.transaction(async (transactionalEntityManager) => {
    await DownloadManager.cancelDownload(gameId);

    await transactionalEntityManager.getRepository(DownloadQueue).delete({
      game: { id: gameId },
    });

    await transactionalEntityManager.getRepository(Game).update(
      {
        id: gameId,
      },
      {
        status: "removed",
        bytesDownloaded: 0,
        progress: 0,
      }
    );
  });
};

registerEvent("cancelGameDownload", cancelGameDownload);
