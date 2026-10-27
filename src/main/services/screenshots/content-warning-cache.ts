import { gamesShopCacheSublevel } from "@main/level";
import {
  buildSteamContentWarning,
  isAdultGameContentWarning,
  isGameContentWarning,
  UNKNOWN_GAME_CONTENT_WARNING,
} from "@shared";
import type { GameContentWarning, GameShop } from "@types";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";

const CONTENT_WARNING_REQUEST_TIMEOUT_MS = 5_000;

const warnings = new Map<string, GameContentWarning>();
const inFlight = new Map<string, Promise<GameContentWarning>>();

const getCacheKey = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

const readLocalShopCacheWarning = async (
  shop: GameShop,
  objectId: string
): Promise<GameContentWarning | null> => {
  if (shop !== "steam") return null;

  const prefix = `${shop}:${objectId}:`;
  const entries = await gamesShopCacheSublevel
    .iterator({ gte: prefix, lt: `${prefix}￿` })
    .all()
    .catch(() => []);

  for (const [, details] of entries) {
    const warning = buildSteamContentWarning(details);
    if (warning) return warning;
  }

  return null;
};

const fetchRemoteWarning = async (shop: GameShop, objectId: string) => {
  const warning = await HydraApi.get<unknown>(
    `/games/${encodeURIComponent(shop)}/${encodeURIComponent(objectId)}/content-warning`,
    undefined,
    { needsAuth: false, timeout: CONTENT_WARNING_REQUEST_TIMEOUT_MS }
  );

  return isGameContentWarning(warning) ? warning : null;
};

const resolveWarning = async (
  shop: GameShop,
  objectId: string
): Promise<GameContentWarning> => {
  if (shop === "custom") return UNKNOWN_GAME_CONTENT_WARNING;

  const local = await readLocalShopCacheWarning(shop, objectId);
  if (local && isAdultGameContentWarning(local)) return local;

  const remote = await fetchRemoteWarning(shop, objectId).catch((error) => {
    logger.warn("Could not fetch the game content warning", {
      shop,
      objectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (remote && remote.level !== "unknown") return remote;

  return local ?? remote ?? UNKNOWN_GAME_CONTENT_WARNING;
};

export class GameContentWarningCache {
  public static prefetch(shop: GameShop, objectId: string) {
    const key = getCacheKey(shop, objectId);
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;

    const request = resolveWarning(shop, objectId)
      .then((warning) => {
        warnings.set(key, warning);
        return warning;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  }

  public static async get(shop: GameShop, objectId: string) {
    const key = getCacheKey(shop, objectId);
    return warnings.get(key) ?? (await this.prefetch(shop, objectId));
  }

  public static clear(shop: GameShop, objectId: string) {
    warnings.delete(getCacheKey(shop, objectId));
  }
}
