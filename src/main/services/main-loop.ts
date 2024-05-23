import { DownloadManager } from "./download-manager";
import { watchProcesses } from "./process-watcher";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startMainLoop = async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await Promise.allSettled([
      watchProcesses(),
      DownloadManager.watchDownloads(),
    ]);

    await sleep(500);
  }
};
