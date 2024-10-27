import {
  DownloadManager,
  Ludusavi,
  PythonInstance,
  startMainLoop,
} from "./services";
import {
  downloadQueueRepository,
  userPreferencesRepository,
} from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/real-debrid";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";
import { TorBoxClient } from "./services/torbox";

const loadState = async (userPreferences: UserPreferences | null) => {
  import("./events");

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);
  }

  if (userPreferences?.torboxApiToken) {
    TorBoxClient.authorize(userPreferences?.torboxApiToken);
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

  if (nextQueueItem?.game.status === "active") {
    DownloadManager.startDownload(nextQueueItem.game);
  } else {
    PythonInstance.spawn();
  }

  startMainLoop();
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
