import type { Game } from "@types";
import { HydraApi } from "../hydra-api";

export const trackGamePlaytime = async (
  game: Game,
  deltaInMillis: number,
  lastTimePlayed: Date
) => {
  if (game.shop === "custom") {
    return;
  }

  return HydraApi.put(`/profile/games/${game.shop}/${game.objectId}`, {
    playTimeDeltaInSeconds: Math.trunc(deltaInMillis / 1000),
    lastTimePlayed,
  });
};
