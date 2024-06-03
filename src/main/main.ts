import { DownloadManager, startMainLoop } from "./services";
import {
  gameRepository,
  repackRepository,
  userPreferencesRepository,
} from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/real-debrid";
import { Not } from "typeorm";
import { repacksWorker } from "./workers";

startMainLoop();

const loadState = async (userPreferences: UserPreferences | null) => {
  import("./events");

  if (userPreferences?.realDebridApiToken)
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);

  const game = await gameRepository.findOne({
    where: {
      status: "active",
      progress: Not(1),
      isDeleted: false,
    },
  });

  if (game) DownloadManager.startDownload(game);

  repackRepository
    .find({
      order: {
        createdAt: "DESC",
      },
    })
    .then((repacks) => {
      repacksWorker.run(repacks, { name: "setRepacks" });
    });
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
