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
import { Toast } from "powertoast";
import { publishNewAchievementNotification } from "./services/notifications";

const loadState = async (userPreferences: UserPreferences | null) => {
  import("./events");

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
    publishNewAchievementNotification({
      icon: "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/72850/c3a604f698d247b53d20f212e9f31a9ec707a180.jpg",
      displayName: "Hydra has started",
      totalAchievementCount: 75,
      unlockedAchievementCount: 23,
    });

    loadState(userPreferences);
  });
