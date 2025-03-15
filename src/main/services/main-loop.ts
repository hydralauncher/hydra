import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { UpdateManager } from "./update-manager";
import { watchFriendRequests } from "@main/events/profile/sync-friend-requests";
import { MAIN_LOOP_INTERVAL } from "@main/constants";

export const startMainLoop = async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await Promise.allSettled([
      watchProcesses(),
      watchFriendRequests(),
      DownloadManager.watchDownloads(),
      AchievementWatcherManager.watchAchievements(),
      DownloadManager.getSeedStatus(),
      UpdateManager.checkForUpdatePeriodically(),
    ]);

    await sleep(MAIN_LOOP_INTERVAL);
  }
};
