import { gameRepository } from "@main/repository";
import { HydraApi } from "../hydra-api";
import { steamGamesWorker } from "@main/workers";
import { steamUrlBuilder } from "@shared";

export const mergeWithRemoteGames = async () => {
  return HydraApi.get("/profile/games")
    .then(async (response) => {
      for (const game of response) {
        const localGame = await gameRepository.findOne({
          where: {
            objectID: game.objectId,
          },
        });

        if (localGame) {
          const updatedLastTimePlayed =
            localGame.lastTimePlayed == null ||
            (game.lastTimePlayed &&
              new Date(game.lastTimePlayed) > localGame.lastTimePlayed)
              ? game.lastTimePlayed
              : localGame.lastTimePlayed;

          const updatedPlayTime =
            localGame.playTimeInMilliseconds < game.playTimeInMilliseconds
              ? game.playTimeInMilliseconds
              : localGame.playTimeInMilliseconds;

          gameRepository.update(
            {
              objectID: game.objectId,
              shop: "steam",
            },
            {
              remoteId: game.id,
              lastTimePlayed: updatedLastTimePlayed,
              playTimeInMilliseconds: updatedPlayTime,
            }
          );
        } else {
          const steamGame = await steamGamesWorker.run(Number(game.objectId), {
            name: "getById",
          });

          if (steamGame) {
            const iconUrl = steamGame?.clientIcon
              ? steamUrlBuilder.icon(game.objectId, steamGame.clientIcon)
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
    })
    .catch(() => {});
};
