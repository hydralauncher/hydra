import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { gamesPlaytime, watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { UpdateManager } from "./update-manager";
import { MAIN_LOOP_INTERVAL } from "@main/constants";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import { OtaUnlockerService } from "./unlockers";

export const startMainLoop = async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await Promise.allSettled([
      watchProcesses(),
      DownloadManager.watchDownloads(),
      AchievementWatcherManager.watchAchievements(),
      DownloadManager.getSeedStatus(),
      UpdateManager.checkForUpdatePeriodically(),
      OtaUnlockerService.checkForUpdatesPeriodically(),
    ]);

    PowerSaveBlockerManager.syncState({
      downloadActive: DownloadManager.hasActiveDownload(),
      compatibilityGameActive:
        PowerSaveBlockerManager.hasRunningCompatibilityGame(
          gamesPlaytime.keys()
        ),
    });

    await sleep(MAIN_LOOP_INTERVAL);
  }
};
