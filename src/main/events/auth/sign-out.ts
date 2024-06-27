import { registerEvent } from "../register-event";
import { HydraApi, TorrentDownloader, gamesPlaytime } from "@main/services";
import { dataSource } from "@main/data-source";
import { DownloadQueue, Game, UserAuth } from "@main/entity";

const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  const databaseOperations = dataSource
    .transaction(async (transactionalEntityManager) => {
      await transactionalEntityManager.getRepository(DownloadQueue).delete({});

      await transactionalEntityManager.getRepository(Game).delete({});

      await transactionalEntityManager
        .getRepository(UserAuth)
        .delete({ id: 1 });
    })
    .then(() => {
      /* Removes all games being played */
      gamesPlaytime.clear();
    });

  /* Disconnects libtorrent */
  TorrentDownloader.kill();

  await Promise.all([
    databaseOperations,
    HydraApi.post("/auth/logout").catch(),
  ]);
};

registerEvent("signOut", signOut);
