import { gameRepository } from "@main/repository";
import { DownloadManager } from "./download/download-manager";
import { sleep } from "@main/helpers";

export const startSeedProcess = async () => {
  const seedList = await gameRepository.find({
    where: {
      shouldSeed: true,
      downloader: 1,
      progress: 1,
    },
  });

  if (seedList.length === 0) return;
  await sleep(1000);

  seedList.map(async (game) => {
    await DownloadManager.startDownload(game);
    await sleep(300);
  });
};
