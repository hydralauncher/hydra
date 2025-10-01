import type { GameShop, GameStats } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { gamesStatsCacheSublevel, levelKeys } from "@main/level";

const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 30; // 30 minutes

const getGameStats = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const cachedStats = await gamesStatsCacheSublevel.get(
    levelKeys.game(shop, objectId)
  );

  if (
    cachedStats &&
    cachedStats.updatedAt + LOCAL_CACHE_EXPIRATION > Date.now()
  ) {
    return cachedStats;
  }

  return HydraApi.get<GameStats>(`/games/${shop}/${objectId}/stats`, null, {
    needsAuth: false,
  }).then(async (data) => {
    await gamesStatsCacheSublevel.put(levelKeys.game(shop, objectId), {
      ...data,
      updatedAt: Date.now(),
    });

    return data;
  });
};

registerEvent("getGameStats", getGameStats);
