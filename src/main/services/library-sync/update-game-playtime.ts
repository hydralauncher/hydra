import { Game } from "@main/entity";
import { HydraApi } from "../hydra-api";

export const updateGamePlaytime = async (
  game: Game,
  deltaInMillis: number,
  lastTimePlayed: Date
) => {
  HydraApi.put(`/games/${game.remoteId}`, {
    playTimeDeltaInSeconds: Math.trunc(deltaInMillis / 1000),
    lastTimePlayed,
  }).catch(() => {});
};
