import type { Game } from "@types";
import { HydraApi } from "../hydra-api";
import { ensureGameInstallation } from "../game-installations";
import { gamesSublevel, levelKeys } from "@main/level";

export const createGame = async (game: Game) => {
  if (game.shop === "custom") {
    return;
  }

  return HydraApi.post(`/profile/games`, {
    objectId: game.objectId,
    playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
  }).then(async (response) => {
    const {
      id: remoteId,
      canonicalGameId,
      selectedStoreMappingId,
      playTimeInMilliseconds,
      lastTimePlayed,
      createdAt,
    } = response;

    const mergedGame = {
      ...game,
      remoteId,
      canonicalGameId: canonicalGameId ?? game.canonicalGameId ?? null,
      storeMappingId: selectedStoreMappingId ?? game.storeMappingId ?? null,
      addedToLibraryAt:
        game.addedToLibraryAt ?? (createdAt ? new Date(createdAt) : new Date()),
      playTimeInMilliseconds,
      lastTimePlayed,
    };

    await gamesSublevel.put(
      levelKeys.game(game.shop, game.objectId),
      await ensureGameInstallation(mergedGame)
    );
  });
};
