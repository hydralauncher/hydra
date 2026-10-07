import { registerEvent } from "../register-event";
import {
  DownloadManager,
  HydraApi,
  SSEClient,
  WindowManager,
  emulators,
  retroarch,
} from "@main/services";
import { clearGamesPlaytimeState } from "@main/services/game-running-state";
import {
  downloadLayoutStateSublevel,
  downloadsSublevel,
  gamesSublevel,
} from "@main/level";

const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  SSEClient.close();

  /* Cancels any ongoing downloads */
  DownloadManager.cancelDownload();

  await HydraApi.handleSignOut(async () => {
    /* Removes all games being played */
    clearGamesPlaytimeState();

    const results = await Promise.allSettled([
      gamesSublevel.clear(),
      downloadsSublevel.clear(),
      downloadLayoutStateSublevel.clear(),
      emulators.resetEmulatorScanData(),
      retroarch.resetRetroArchScanData(),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  });

  /* The friends window is only meaningful while signed in */
  if (!HydraApi.isLoggedIn()) WindowManager.closeFriendsWindow();
};

registerEvent("signOut", signOut);
