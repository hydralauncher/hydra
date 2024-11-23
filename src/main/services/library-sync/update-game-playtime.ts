import { Game } from "@main/entity";
import { HydraApi } from "../hydra-api";

export const updateGamePlaytime = async (
  game: Game,
  deltaInMillis: number,
  lastTimePlayed: Date
) => {
  return HydraApi.put(`/profile/games/${game.remoteId}`, {
    playTimeDeltaInSeconds: Math.trunc(deltaInMillis / 1000),
    lastTimePlayed,
  });
};
