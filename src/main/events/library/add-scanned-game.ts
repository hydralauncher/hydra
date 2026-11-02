import { registerEvent } from "../register-event";
import { addGameOutsideLibrary } from "./scan-installed-games";
import { WindowManager } from "@main/services";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";

const addScannedGames = async (
  _event: Electron.IpcMainInvokeEvent,
  picks: { objectId: string; executablePath: string }[]
) => {
  const addedGames = await AchievementWatcherManager.runBatch(async () => {
    const results: NonNullable<
      Awaited<ReturnType<typeof addGameOutsideLibrary>>
    >[] = [];

    for (const { objectId, executablePath } of picks) {
      const addedGame = await addGameOutsideLibrary(
        objectId,
        executablePath
      ).catch(() => null);

      if (addedGame) results.push(addedGame);
    }

    return results;
  });

  if (addedGames.length > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return addedGames;
};

registerEvent("addScannedGames", addScannedGames);
