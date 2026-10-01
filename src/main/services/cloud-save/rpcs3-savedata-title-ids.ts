import type { Game } from "@types";

import {
  normalizeRpcs3TitleId,
  rpcs3SavedataTitleIdsForGame,
  rpcs3TitleIdsForGame,
} from "./rpcs3-title-ids.js";

const currentCatalogueIds = new Map<string, readonly string[]>();
const catalogueKey = (game: Game) => JSON.stringify([game.shop, game.objectId]);

export const rememberRpcs3CatalogueTitleIds = (
  game: Game,
  titleIds: Iterable<unknown>
) => {
  currentCatalogueIds.set(
    catalogueKey(game),
    [...titleIds]
      .map(normalizeRpcs3TitleId)
      .filter((id): id is string => id !== null)
  );
};

const readCachedCatalogueTitleIds = async (game: Game): Promise<unknown[]> => {
  const current = currentCatalogueIds.get(catalogueKey(game));
  if (current) return [...current];
  const { gamesShopCacheSublevel, levelKeys } = await import("@main/level");
  const prefix = `${levelKeys.game(game.shop, game.objectId)}:`;
  const entries = await gamesShopCacheSublevel
    .iterator({ gte: prefix, lt: `${prefix}\uffff` })
    .all();
  return rpcs3TitleIdsFromCachedDetails(game, entries);
};

export const rpcs3TitleIdsFromCachedDetails = (
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

export const getRpcs3SavedataTitleIds = async (
  game: Game,
  readCatalogue: (
    game: Game
  ) => Promise<Iterable<unknown>> = readCachedCatalogueTitleIds
): Promise<string[]> => {
  if (!rpcs3TitleIdsForGame(game).length) return [];
  // Cache access is optional. Local discovery must keep working without it.
  const catalogueIds = await readCatalogue(game).catch(() => []);
  return rpcs3SavedataTitleIdsForGame(game, catalogueIds);
};

export const cacheRpcs3CatalogueTitleIds = async (
  game: Game,
  titleIds: Iterable<string>
): Promise<void> => {
  const { gamesShopCacheSublevel, levelKeys } = await import("@main/level");
  const prefix = `${levelKeys.game(game.shop, game.objectId)}:`;
  const entries = await gamesShopCacheSublevel
    .iterator({ gte: prefix, lt: `${prefix}\uffff` })
    .all();
  const skus = [...titleIds]
    .map(normalizeRpcs3TitleId)
    .filter((id): id is string => !!id);
  for (const [key, details] of entries) {
    if (details?.objectId !== game.objectId) continue;
    // Preserve descriptions, artwork and other cached shop details.
    await gamesShopCacheSublevel.put(key, { ...details, skus });
  }
};
