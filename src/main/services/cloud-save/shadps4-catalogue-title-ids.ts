import type { Game } from "@types";

import { readCachedCatalogueTitleIds } from "./rpcs3-savedata-title-ids.js";
import { normalizeRpcs3CatalogueTitleId } from "./rpcs3-title-ids.js";

const normalizeAll = (ids: Iterable<unknown>) => [
  ...new Set(
    [...ids]
      .map(normalizeRpcs3CatalogueTitleId)
      .filter((id): id is string => id !== null)
  ),
];

/** A game the catalogue had no title IDs for is not asked again for a while. */
const EMPTY_LOOKUP_RETRY_MS = 10 * 60 * 1000;
const emptyLookups = new Map<string, number>();

/**
 * The title IDs of every version of the game (regions, editions), as the
 * catalogue lists them. Read from the shop details already cached, and asked
 * to the API only when there are none. Empty when neither has them.
 */
export const getShadps4CatalogueTitleIds = async (
  game: Game
): Promise<string[]> => {
  const cached = normalizeAll(
    await readCachedCatalogueTitleIds(game).catch(() => [])
  );
  if (cached.length) return cached;

  const key = `${game.shop}:${game.objectId}`;
  const emptyAt = emptyLookups.get(key);
  if (emptyAt !== undefined && Date.now() - emptyAt < EMPTY_LOOKUP_RETRY_MS) {
    return [];
  }
  try {
    const { getRpcs3CatalogueTitleIds } = await import(
      "./rpcs3-game-identity.js"
    );
    const ids = normalizeAll(await getRpcs3CatalogueTitleIds(game));
    if (ids.length) {
      emptyLookups.delete(key);
      return ids;
    }
  } catch {
    // Remembered below, like an empty answer.
  }
  emptyLookups.set(key, Date.now());
  return [];
};
