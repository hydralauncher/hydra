import { DownloadManager, Ludusavi, startMainLoop } from "./services";
import { downloadQueueRepository, userPreferencesRepository } from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/download/real-debrid";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";
import { PythonRPC } from "./services/python-rpc";
import { Aria2 } from "./services/aria2";
import { startSeedProcess } from "./services/seed";
import { sleep } from "./helpers";

const loadState = async (userPreferences: UserPreferences | null) => {
  import("./events");

  Aria2.spawn();

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);
  }

  Ludusavi.addManifestToLudusaviConfig();

  HydraApi.setupApi().then(() => {
    uploadGamesBatch();
  });


  const [nextQueueItem] = await downloadQueueRepository.find({
    order: {
      id: "DESC",
    },
    relations: {
      game: true,
    },
  });

  PythonRPC.spawn();
  await sleep(1000);
  // wait for python process to start 

  if (nextQueueItem?.game.status === "active") {
    DownloadManager.startDownload(nextQueueItem.game);
  }

  await startSeedProcess();

  startMainLoop();
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
