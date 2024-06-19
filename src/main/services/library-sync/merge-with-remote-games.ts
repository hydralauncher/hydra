import { gameRepository } from "@main/repository";
import { HydraApi } from "../hydra-api";
import { steamGamesWorker } from "@main/workers";
import { getSteamAppAsset } from "@main/helpers";
import { logger } from "../logger";
import { AxiosError } from "axios";

export const mergeWithRemoteGames = async () => {
  try {
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
        const steamGame = await steamGamesWorker.run(Number(game.objectId), {
          name: "getById",
        });

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
  } catch (err) {
    if (err instanceof AxiosError) {
      logger.error("getRemoteGames", err.response, err.message);
    } else {
      logger.error("getRemoteGames", err);
    }
  }
};
