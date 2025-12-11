import type { Game } from "@types";
import { HydraApi } from "../hydra-api";
import { gamesSublevel, levelKeys } from "@main/level";

export const createGame = async (game: Game) => {
  if (game.shop === "custom") {
    return;
  }

  return HydraApi.post<{
    id: string;
    playTimeInMilliseconds: number;
    lastTimePlayed: string | null;
  }>(`/profile/games`, {
    objectId: game.objectId,
    playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
  }).then((response) => {
    const {
      id: remoteId,
      playTimeInMilliseconds,
      lastTimePlayed: lastTimePlayedStr,
    } = response;

    const lastTimePlayed = lastTimePlayedStr
      ? new Date(lastTimePlayedStr)
      : null;

    gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
      ...game,
      remoteId,
      playTimeInMilliseconds,
      lastTimePlayed,
    });
  });
};
