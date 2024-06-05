import { DownloadManager, RepacksManager, startMainLoop } from "./services";
import {
  downloadQueueRepository,
  userPreferencesRepository,
} from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/real-debrid";
import { fetchDownloadSourcesAndUpdate } from "./helpers";
import { publishNewRepacksNotifications } from "./services/notifications";

startMainLoop();

const loadState = async (userPreferences: UserPreferences | null) => {
  await RepacksManager.updateRepacks();

  import("./events");

  if (userPreferences?.realDebridApiToken)
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);

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

  fetchDownloadSourcesAndUpdate().then(() => {
    publishNewRepacksNotifications(300);
  });
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
