import { Game } from "@main/entity";
import { HydraApi } from "../hydra-api";
import { gameRepository } from "@main/repository";

export const createGame = async (game: Game) => {
  HydraApi.post(`/games`, {
    objectId: game.objectID,
    playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
  })
    .then((response) => {
      const {
        id: remoteId,
        playTimeInMilliseconds,
        lastTimePlayed,
      } = response.data;

      gameRepository.update(
        { objectID: game.objectID },
        { remoteId, playTimeInMilliseconds, lastTimePlayed }
      );
    })
    .catch();
};
