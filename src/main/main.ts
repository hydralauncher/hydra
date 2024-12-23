import { Ludusavi, startMainLoop } from "./services";
import {
  downloadQueueRepository,
  userPreferencesRepository,
} from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/download/real-debrid";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";
import { PythonRPC } from "./services/python-rpc";
import { Aria2 } from "./services/aria2";
import { startSeedProcess } from "./services/seed";

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

  if (
    nextQueueItem?.game.status === "active" &&
    nextQueueItem?.game.id &&
    nextQueueItem?.game.uri &&
    nextQueueItem?.game.downloadPath
  ) {
    PythonRPC.spawn({
      game_id: nextQueueItem.game.id,
      url: nextQueueItem.game.uri,
      save_path: nextQueueItem.game.downloadPath,
    });
  } else {
    PythonRPC.spawn();
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
