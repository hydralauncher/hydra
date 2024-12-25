import { DownloadManager, Ludusavi, startMainLoop } from "./services";
import {
  downloadQueueRepository,
  gameRepository,
  userPreferencesRepository,
} from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/download/real-debrid";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";
import { Aria2 } from "./services/aria2";
import { Downloader } from "@shared";
import { IsNull, Not } from "typeorm";
import { TorBoxClient } from "./services/download/torbox";

const loadState = async (userPreferences: UserPreferences | null) => {
  import("./events");

  Aria2.spawn();

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);
  }

  TorBoxClient.authorize("7371d5ec-52fa-4b87-9052-0c8c96d947cc");

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

  const seedList = await gameRepository.find({
    where: {
      shouldSeed: true,
      downloader: Downloader.Torrent,
      progress: 1,
      uri: Not(IsNull()),
    },
  });

  await DownloadManager.startRPC(nextQueueItem?.game, seedList);

  startMainLoop();
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
