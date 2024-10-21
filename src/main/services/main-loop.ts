import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";

export const startMainLoop = async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await Promise.allSettled([
      watchProcesses(),
      DownloadManager.watchDownloads(),
      AchievementWatcherManager.watchAchievements(),
    ]);

    await sleep(1500);
  }
};
