import { DownloadManager, SearchEngine, startMainLoop } from "./services";
import { gameRepository, userPreferencesRepository } from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/real-debrid";
import { Not } from "typeorm";

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
  await SearchEngine.updateRepacks();
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
