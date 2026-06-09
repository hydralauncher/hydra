/* SteamSpy-based per-game user-tag lookup.
 *
 * Hydra's catalogue API doesn't expose a game's actual Steam User Tags
 * (the catalogue's `genres` field is the broader Steam category set —
 * "Action", "RPG" — not user tags like "Psychological Horror" or
 * "Visual Novel"). We use SteamSpy as a side-channel: it scrapes the
 * Steam store and returns user tags ranked by vote count.
 *
 * Endpoint: https://steamspy.com/api.php?request=appdetails&appid=<id>
 * Response shape (relevant subset):
 *   { "tags": { "Psychological Horror": 2351, "Visual Novel": 1894, ... } }
 *
 * Caller is responsible for mapping returned tag NAMES to numeric IDs
 * via Hydra's steamUserTags map (the catalogue search filter requires
 * IDs, not names).
 *
 * Failures (network, CORS, malformed payload) return an empty array
 * so callers can fall back to their previous heuristic without
 * branching on errors.
 */

export async function fetchSteamSpyTopTags(
  objectId: string
): Promise<string[]> {
  try {
    const res = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${encodeURIComponent(
        objectId
      )}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { tags?: Record<string, number> };
    const tags = data?.tags;
    if (!tags || typeof tags !== "object") return [];
    return Object.entries(tags)
      .map(([name, votes]) => [name, Number(votes)] as const)
      .filter(([, v]) => Number.isFinite(v) && v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([n]) => n);
  } catch {
    return [];
  }
}
