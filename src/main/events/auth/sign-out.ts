import { registerEvent } from "../register-event";
import {
  DownloadManager,
  HydraApi,
  WSClient,
  gamesPlaytime,
} from "@main/services";
import {
  db,
  downloadLayoutStateSublevel,
  downloadsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";

const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  const databaseOperations = db
    .batch([
      {
        type: "del",
        key: levelKeys.auth,
      },
      {
        type: "del",
        key: levelKeys.user,
      },
    ])
    .then(async () => {
      /* Removes all games being played */
      gamesPlaytime.clear();

      const games = await gamesSublevel.iterator().all();
      const cloudGameDeletions = games
        .filter(([, game]) => game.shop !== "launchbox")
        .map(([key]) => ({ type: "del" as const, key }));

      return Promise.all([
        cloudGameDeletions.length > 0
          ? gamesSublevel.batch(cloudGameDeletions)
          : Promise.resolve(),
        downloadsSublevel.clear(),
        downloadLayoutStateSublevel.clear(),
      ]);
    });

  /* Cancels any ongoing downloads */
  DownloadManager.cancelDownload();

  HydraApi.handleSignOut();

  await Promise.all([
    databaseOperations,
    HydraApi.post("/auth/logout").catch(() => {}),
  ]);

  WSClient.close();
};

registerEvent("signOut", signOut);
