import { registerEvent } from "../register-event";
import { DownloadManager, HydraApi, gamesPlaytime } from "@main/services";
import { dataSource } from "@main/data-source";
import { DownloadQueue, Game, UserAuth, UserSubscription } from "@main/entity";
import { PythonRPC } from "@main/services/python-rpc";

const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  const databaseOperations = dataSource
    .transaction(async (transactionalEntityManager) => {
      await transactionalEntityManager.getRepository(DownloadQueue).delete({});

      await transactionalEntityManager.getRepository(Game).delete({});

      await transactionalEntityManager
        .getRepository(UserAuth)
        .delete({ id: 1 });

      await transactionalEntityManager
        .getRepository(UserSubscription)
        .delete({ id: 1 });
    })
    .then(() => {
      /* Removes all games being played */
      gamesPlaytime.clear();
    });

  /* Cancels any ongoing downloads */
  DownloadManager.cancelDownload();

  /* Disconnects libtorrent */
  PythonRPC.kill();

  HydraApi.handleSignOut();

  await Promise.all([
    databaseOperations,
    HydraApi.post("/auth/logout").catch(() => {}),
  ]);
};

registerEvent("signOut", signOut);
