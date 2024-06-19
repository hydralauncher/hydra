import { DownloadManager, RepacksManager, startMainLoop } from "./services";
import {
  downloadQueueRepository,
  repackRepository,
  userPreferencesRepository,
} from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/real-debrid";
import { fetchDownloadSourcesAndUpdate } from "./helpers";
import { publishNewRepacksNotifications } from "./services/notifications";
import { MoreThan } from "typeorm";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";

startMainLoop();

const loadState = async (userPreferences: UserPreferences | null) => {
  await RepacksManager.updateRepacks();

  import("./events");

  if (userPreferences?.realDebridApiToken)
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);

  HydraApi.setupApi().then(async () => {
    if (HydraApi.isLoggedIn()) uploadGamesBatch();
  });

  const [nextQueueItem] = await downloadQueueRepository.find({
    order: {
      id: "DESC",
    },
    relations: {
      game: true,
    },
  });

  if (nextQueueItem?.game.status === "active")
    DownloadManager.startDownload(nextQueueItem.game);

  const now = new Date();

  fetchDownloadSourcesAndUpdate().then(async () => {
    const newRepacksCount = await repackRepository.count({
      where: {
        createdAt: MoreThan(now),
      },
    });

    if (newRepacksCount > 0) publishNewRepacksNotifications(newRepacksCount);
  });
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
