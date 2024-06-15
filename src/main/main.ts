import {
  DownloadManager,
  RepacksManager,
  logger,
  startMainLoop,
} from "./services";
import {
  downloadQueueRepository,
  gameRepository,
  repackRepository,
  userPreferencesRepository,
} from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/real-debrid";
import { fetchDownloadSourcesAndUpdate, getSteamAppAsset } from "./helpers";
import { publishNewRepacksNotifications } from "./services/notifications";
import { MoreThan } from "typeorm";
import { HydraApi } from "./services/hydra-api";
import { steamGamesWorker } from "./workers";

startMainLoop();

const loadState = async (userPreferences: UserPreferences | null) => {
  await RepacksManager.updateRepacks();

  import("./events");

  if (userPreferences?.realDebridApiToken)
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);

  HydraApi.setupApi()
    .then(async () => {
      if (HydraApi.isLoggedIn()) {
        const games = await HydraApi.get("/games");

        for (const game of games.data) {
          const localGame = await gameRepository.findOne({
            where: {
              objectID: game.objectId,
            },
          });

          if (localGame) {
            const updatedLastTimePlayed =
              localGame.lastTimePlayed == null ||
              new Date(game.lastTimePlayed) > localGame.lastTimePlayed
                ? new Date(game.lastTimePlayed)
                : localGame.lastTimePlayed;

            const updatedPlayTime =
              localGame.playTimeInMilliseconds < game.playTimeInMilliseconds
                ? game.playTimeInMilliseconds
                : localGame.playTimeInMilliseconds;

            gameRepository.update(
              {
                objectID: game.objectId,
                shop: "steam",
                lastTimePlayed: updatedLastTimePlayed,
                playTimeInMilliseconds: updatedPlayTime,
              },
              { remoteId: game.id }
            );
          } else {
            const steamGame = await steamGamesWorker.run(
              Number(game.objectId),
              {
                name: "getById",
              }
            );

            if (steamGame) {
              const iconUrl = steamGame?.clientIcon
                ? getSteamAppAsset("icon", game.objectId, steamGame.clientIcon)
                : null;

              gameRepository.insert({
                objectID: game.objectId,
                title: steamGame?.name,
                remoteId: game.id,
                shop: game.shop,
                iconUrl,
                lastTimePlayed: game.lastTimePlayed,
                playTimeInMilliseconds: game.playTimeInMilliseconds,
              });
            }
          }
        }
      }
    })
    .catch((err) => {
      logger.error("erro api GET: /games", err);
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
