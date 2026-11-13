import type { Game } from "@types";

import {
  fetchCatalogueTitleIds,
  normalizeCatalogueTitleIds,
  readCachedCatalogueTitleIds,
} from "./catalogue-title-ids.js";

/** A game the catalogue answered with no title IDs is not asked again for a while. */
const EMPTY_ANSWER_RETRY_MS = 10 * 60 * 1000;
const emptyAnswers = new Map<string, number>();
const runningLookups = new Map<string, Promise<string[]>>();

const lookUp = async (game: Game, key: string): Promise<string[]> => {
  let ids: string[];
  try {
    ids = normalizeCatalogueTitleIds(await fetchCatalogueTitleIds(game));
  } catch {
    // A failed request is not remembered, so the next sync asks again.
    return [];
  }
  if (ids.length) emptyAnswers.delete(key);
  else emptyAnswers.set(key, Date.now());
  return ids;
};

/**
 * The title IDs of every version of the game (regions, editions), as the
 * catalogue lists them. Read from the shop details already cached, and asked
 * to the API only when there are none. Empty when neither has them.
 */
export const getShadps4CatalogueTitleIds = async (
  game: Game
): Promise<string[]> => {
  const cached = normalizeCatalogueTitleIds(
    await readCachedCatalogueTitleIds(game).catch(() => [])
  );
  if (cached.length) return cached;

  const key = `${game.shop}:${game.objectId}`;
  const emptyAt = emptyAnswers.get(key);
  if (emptyAt !== undefined && Date.now() - emptyAt < EMPTY_ANSWER_RETRY_MS) {
    return [];
  }

  // A scan and a restore can ask at the same time: they share one request.
  let pending = runningLookups.get(key);
  if (!pending) {
    pending = lookUp(game, key).finally(() => runningLookups.delete(key));
    runningLookups.set(key, pending);
  }
  return pending;
};
