import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { gamesPlaytime, watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { UpdateManager } from "./update-manager";
import { INTERVALS } from "@main/constants";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import { logger } from "./logger";

const wrapInLoop = (fn: () => unknown, interval: number) => {
  const loop = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await fn();
      } catch (error) {
        logger.error(
          `Error in loop: ${error instanceof Error ? error.stack : String(error)}`
        );
      }

      await sleep(interval);
    }
  };
  loop();
};

export const startMainLoop = async () => {
  wrapInLoop(() => watchProcesses(), INTERVALS.processWatcher);
  wrapInLoop(() => DownloadManager.watchDownloads(), INTERVALS.downloadWatcher);
  wrapInLoop(
    () => AchievementWatcherManager.watchAchievements(),
    INTERVALS.achievementWatcher
  );
  wrapInLoop(
    () => DownloadManager.getSeedStatus(),
    INTERVALS.seedStatusWatcher
  );
  wrapInLoop(() => UpdateManager.checkForUpdates(), INTERVALS.updateChecker);

  wrapInLoop(() => {
    PowerSaveBlockerManager.syncState({
      downloadActive: DownloadManager.hasActiveDownload(),
      compatibilityGameActive:
        PowerSaveBlockerManager.hasRunningCompatibilityGame(
          gamesPlaytime.keys()
        ),
    });
  }, INTERVALS.powerSaveBlockerSync);
};
