import { Game } from "@main/entity";
import { HydraApi } from "../hydra-api";

export const updateGamePlaytime = async (
  game: Game,
  delta: number,
  lastTimePlayed: Date
) => {
  return HydraApi.put(`/games/${game.remoteId}`, {
    playTimeDeltaInSeconds: delta,
    lastTimePlayed,
  });
};
