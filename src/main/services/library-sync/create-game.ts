import { Game } from "@main/entity";
import { HydraApi } from "../hydra-api";
import { gameRepository } from "@main/repository";
import { logger } from "../logger";

export const createGame = async (game: Game) => {
  HydraApi.post(
    "/games/download",
    {
      objectId: game.objectID,
      shop: game.shop,
    },
    { needsAuth: false }
  ).catch((err) => {
    logger.error("Failed to create game download", err);
  });

  HydraApi.post(`/profile/games`, {
    objectId: game.objectID,
    playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
  })
    .then((response) => {
      const { id: remoteId, playTimeInMilliseconds, lastTimePlayed } = response;

      gameRepository.update(
        { objectID: game.objectID },
        { remoteId, playTimeInMilliseconds, lastTimePlayed }
      );
    })
    .catch(() => {});
};
