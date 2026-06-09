import { levelDBService } from "@renderer/services/leveldb.service";
import type { HomeRowGame } from "./home-game-card";

/**
 * Home row cache backed by levelDB.
 *
 * The cache is a *paint optimisation* — when the user re-opens the app, rows
 * paint instantly with last-known data while the background fetch runs and
 * silently swaps in fresh results. No TTL: every fetch overwrites the entry.
 *
 * All rows live under the `homeRows` sublevel, keyed by a stable row id.
 */
const SUBLEVEL = "homeRows";

export type HomeCacheKey =
  | "popular"
  | "mostPlayedHydra"
  | "weekly"
  | "topReviewed"
  | "featuredOnLerna"
  | "recentlyAdded"
  | "hiddenGems"
  | "classics"
  | "ps1"
  | "ps2"
  | "ps3"
  | "retroPc"
  | "criticallyAcclaimed"
  | "brandNew"
  | "deckVerified"
  | `spotlight:${string}`
  | `genre:${string}`
  | `tag:${string}`
  | `similar:${string}`
  /* Per-(platform, genre) classics fetches — e.g. "classics:ps2:Horror".
     Backed by /catalogue/search with the combined {platforms, genres}
     filter so PS2/PS3 genre rows surface real popularity-sorted data
     instead of relying on the client-side title-keyword fallback in
     classicsByPlatformAndGenre. */
  | `classics:${string}:${string}`;

export async function readHomeCache(
  key: HomeCacheKey
): Promise<HomeRowGame[] | null> {
  try {
    const value = await levelDBService.get(key, SUBLEVEL, "json");
    if (Array.isArray(value)) return value as HomeRowGame[];
    return null;
  } catch {
    return null;
  }
}

export async function writeHomeCache(
  key: HomeCacheKey,
  games: HomeRowGame[]
): Promise<void> {
  try {
    await levelDBService.put(key, games, SUBLEVEL, "json");
  } catch {
    /* cache is best-effort — never block the UI on persistence */
  }
}

/**
 * Read many cache keys in parallel. Missing keys map to `null` so the caller
 * can seed initial state in a single pass.
 */
export async function readHomeCacheMany(
  keys: HomeCacheKey[]
): Promise<Record<string, HomeRowGame[] | null>> {
  const entries = await Promise.all(
    keys.map(async (k) => [k, await readHomeCache(k)] as const)
  );
  return Object.fromEntries(entries);
}
