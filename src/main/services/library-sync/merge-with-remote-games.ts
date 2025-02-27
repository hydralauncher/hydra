import { HydraApi } from "../hydra-api";
import { steamGamesWorker } from "@main/workers";
import { steamUrlBuilder } from "@shared";
import { gamesSublevel, levelKeys } from "@main/level";

export const mergeWithRemoteGames = async () => {
  return HydraApi.get("/profile/games")
    .then(async (response) => {
      for (const game of response) {
        const localGame = await gamesSublevel.get(
          levelKeys.game(game.shop, game.objectId)
        );

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

          await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
            ...localGame,
            remoteId: game.id,
            lastTimePlayed: updatedLastTimePlayed,
            playTimeInMilliseconds: updatedPlayTime,
          });
        } else {
          const steamGame = await steamGamesWorker.run(Number(game.objectId), {
            name: "getById",
          });

          const iconUrl = steamGame?.clientIcon
            ? steamUrlBuilder.icon(game.objectId, steamGame.clientIcon)
            : null;

          await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
            objectId: game.objectId,
            title: steamGame?.name,
            remoteId: game.id,
            shop: game.shop,
            iconUrl,
            lastTimePlayed: game.lastTimePlayed,
            playTimeInMilliseconds: game.playTimeInMilliseconds,
            isDeleted: false,
          });
        }
      }
    })
    .catch(() => {});
};
