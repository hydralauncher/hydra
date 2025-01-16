import { registerEvent } from "../register-event";
import { DownloadManager, HydraApi, gamesPlaytime } from "@main/services";
import { dataSource } from "@main/data-source";
import { DownloadQueue, Game } from "@main/entity";
import { PythonRPC } from "@main/services/python-rpc";
import { db } from "@main/level";
import { levelKeys } from "@main/level";

const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  const databaseOperations = dataSource
    .transaction(async (transactionalEntityManager) => {
      await transactionalEntityManager.getRepository(DownloadQueue).delete({});

      await transactionalEntityManager.getRepository(Game).delete({});

      await db.batch([
        {
          type: "del",
          key: levelKeys.auth,
        },
        {
          type: "del",
          key: levelKeys.user,
        },
      ]);
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
