import { Game } from "@main/entity";
import { HydraApi } from "../hydra-api";

export const createGame = async (game: Game) => {
  return HydraApi.post(`/games`, {
    objectId: game.objectID,
    playTimeInMilliseconds: Math.round(game.playTimeInMilliseconds),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
  });
};
