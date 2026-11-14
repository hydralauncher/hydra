import type { Game } from "@types";

/**
 * Title IDs of every version of a game (regions, editions), as the catalogue
 * lists them in its shop details `skus`. Shared by the disc-based emulators
 * (RPCS3, shadPS4).
 */

const CATALOGUE_TITLE_ID = /^([A-Z]{4}\d{5})[A-Z]*$/;

export const normalizeCatalogueTitleId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return CATALOGUE_TITLE_ID.exec(normalized)?.[1] ?? null;
};

export const normalizeCatalogueTitleIds = (
  ids: Iterable<unknown>
): string[] => [
  ...new Set(
    [...ids]
      .map(normalizeCatalogueTitleId)
      .filter((id): id is string => id !== null)
  ),
];

export interface CatalogueEntry {
  objectId: string;
  shop: string;
  skus?: string[];
}

export const catalogueTitleIdsFromEntries = (
  entries: CatalogueEntry[],
  objectId: string
) => {
  const entry = Array.isArray(entries)
    ? entries.find(
        (item) => item.objectId === objectId && item.shop === "launchbox"
      )
    : null;
  return new Set(
    normalizeCatalogueTitleIds(Array.isArray(entry?.skus) ? entry.skus : [])
  );
};

const currentCatalogueIds = new Map<string, readonly string[]>();
const catalogueKey = (game: Game) => JSON.stringify([game.shop, game.objectId]);

export const rememberCatalogueTitleIds = (
  game: Game,
  titleIds: Iterable<unknown>
) => {
  currentCatalogueIds.set(
    catalogueKey(game),
    normalizeCatalogueTitleIds(titleIds)
  );
};

export const catalogueTitleIdsFromCachedDetails = (
  game: Game,
  entries: ReadonlyArray<
    readonly [string, { objectId?: unknown; skus?: unknown } | null]
  >
): unknown[] => {
  const prefix = `${game.shop}:${game.objectId}:`;
  return entries.flatMap(([key, details]) =>
    key.startsWith(prefix) &&
    details?.objectId === game.objectId &&
    Array.isArray(details.skus)
      ? details.skus
      : []
  );
};

/** The title IDs already known: from this session, else the shop details cache. */
export const readCachedCatalogueTitleIds = async (
  game: Game
): Promise<unknown[]> => {
  const current = currentCatalogueIds.get(catalogueKey(game));
  if (current) return [...current];
  const { gamesShopCacheSublevel, levelKeys } = await import("@main/level");
  const prefix = `${levelKeys.game(game.shop, game.objectId)}:`;
  const entries = await gamesShopCacheSublevel
    .iterator({ gte: prefix, lt: `${prefix}￿` })
    .all();
  return catalogueTitleIdsFromCachedDetails(game, entries);
};

export const cacheCatalogueTitleIds = async (
  game: Game,
  titleIds: Iterable<string>
): Promise<void> => {
  const { gamesShopCacheSublevel, levelKeys } = await import("@main/level");
  const prefix = `${levelKeys.game(game.shop, game.objectId)}:`;
  const entries = await gamesShopCacheSublevel
    .iterator({ gte: prefix, lt: `${prefix}￿` })
    .all();
  const skus = normalizeCatalogueTitleIds(titleIds);
  for (const [key, details] of entries) {
    if (details?.objectId !== game.objectId) continue;
    // Preserve descriptions, artwork and other cached shop details.
    await gamesShopCacheSublevel.put(key, { ...details, skus });
  }
};

/**
 * Asks the API for the game's title IDs. Throws when the request fails, and
 * resolves to an empty set when the catalogue answered with none. Found IDs
 * are remembered for the session and kept in the shop details cache.
 */
export const fetchCatalogueTitleIds = async (
  game: Game
): Promise<Set<string>> => {
  const { HydraApi } = await import("../hydra-api.js");
  const entries = await HydraApi.post<CatalogueEntry[]>(
    "/games/shop-details",
    { shop: "launchbox", objectIds: [game.objectId] },
    { needsAuth: false }
  );
  const ids = catalogueTitleIdsFromEntries(entries, game.objectId);
  if (ids.size) {
    rememberCatalogueTitleIds(game, ids);
    await cacheCatalogueTitleIds(game, ids).catch(() => undefined);
  }
  return ids;
};
