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
  try {
    const { getRpcs3CatalogueTitleIds } = await import(
      "./rpcs3-game-identity.js"
    );
    return normalizeAll(await getRpcs3CatalogueTitleIds(game));
  } catch {
    return [];
  }
};
