import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { watchProcesses } from "./process-watcher";
import { watchAchievements } from "./achievements/achievement-watcher";

export const startMainLoop = async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await Promise.allSettled([
      watchProcesses(),
      DownloadManager.watchDownloads(),
      watchAchievements(),
    ]);

    await sleep(1500);
  }
};
