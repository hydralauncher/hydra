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
import {
  publishCombinedNewAchievementNotification,
  publishNewAchievementNotification,
} from "./services/notifications";

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
    publishCombinedNewAchievementNotification(1000, 999);

    publishNewAchievementNotification({
      achievements: [
        {
          displayName: "Teste 1",
          iconUrl:
            "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/105600/0fbb33098c9da39d1d4771d8209afface9c46e81.jpg",
        },
      ],
      unlockedAchievementCount: 10,
      totalAchievementCount: 34,
      gameTitle: "Teste",
      gameIcon: null,
    });

    loadState(userPreferences);
  });
