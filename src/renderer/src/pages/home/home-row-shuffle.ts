/**
 * Row-order shuffle with adjacency constraints.
 *
 * The user wants Home tiers past position 10 to feel different on
 * every Hydra launch, but not so different that genre rows clump
 * (e.g. four genre rows back-to-back reads as "samey"). This helper
 * applies a deterministic shuffle keyed by sessionSeed, then enforces:
 *   - no two adjacent rows share the same category
 *   - `classics-platform` rows are at least `classicsPlatformGap`
 *     apart (PS1/PS2/PS3 alongside each other was the worst offender)
 *
 * The constraint walker is greedy: for each output slot it looks at
 * the next acceptable candidate further in the remaining queue. If
 * none exists (rare, only when the queue is nearly drained of
 * non-matching kinds) it accepts the violation rather than infinite-
 * loop — the visual cost is at most one same-category pairing near
 * the very end of the row list.
 */

export type HomeRowCategory =
  | "discovery"
  | "curated"
  | "personal"
  | "genre"
  | "tag"
  | "classics-platform"
  | "classics-genre"
  | "spotlight";

/* Minimal contract every row spec must satisfy — `id` for React key
 * stability across shuffles + `category` for the adjacency rules.
 * Optional `isVertical` flags rows whose HomeRow renders portrait-
 * style cards (cardStyle="vertical"); the shuffler keeps those from
 * being adjacent so the home page doesn't show two portrait shelves
 * back-to-back regardless of category match. Optional `platform`
 * (one of "ps1"/"ps2"/"ps3") tags rows that surface a specific
 * classic platform — the shuffler keeps two same-platform rows from
 * sitting back-to-back so e.g. "Popular PS2 Games" + "PS2 RPG
 * Classics" never stack. Callers add whatever extra fields they need
 * (a render function, etc.) and the shuffle passes those through
 * untouched. */
export interface HomeRowSpec {
  id: string;
  category: HomeRowCategory;
  isVertical?: boolean;
  platform?: "ps1" | "ps2" | "ps3";
}

/** Tiny mulberry32-style PRNG. Kept inline (no global RNG state) so
 *  the same `sessionSeed` always yields the same order. */
export const makeRng = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const fisherYates = <T>(arr: T[], rng: () => number): T[] => {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export function shuffleWithSeparation<T extends HomeRowSpec>(
  rows: T[],
  sessionSeed: number,
  options: { classicsPlatformGap?: number } = {}
): T[] {
  const classicsPlatformGap = options.classicsPlatformGap ?? 2;
  const rng = makeRng(sessionSeed);
  const queue = fisherYates(rows, rng);
  const out: T[] = [];

  /* Map a category to its theme family. Rows in the same family
     read as "the same kind of row" to the user even when their
     literal `category` differs — e.g. a PC "Action" genre row and
     a "PS2 Action Classics" classics-genre row are both
     genre-themed; placing them adjacent reads as repetition. The
     family covers all attribute-themed categories
     (genre / tag / classics-genre) since each is a row "about an
     attribute of the game". */
  const themeFamily = (cat: HomeRowCategory): "theme" | HomeRowCategory => {
    if (cat === "genre" || cat === "tag" || cat === "classics-genre") {
      return "theme";
    }
    return cat;
  };

  const isViolation = (candidate: T, list: T[]): boolean => {
    if (list.length === 0) return false;
    const prev = list[list.length - 1];
    /* Same-category adjacency check — kept as a defensive guard
       even though the theme-family rule below now subsumes the
       genre/tag/classics-genre intra-category pairs the user
       originally complained about. */
    const samePair =
      (candidate.category === "genre" && prev.category === "genre") ||
      (candidate.category === "tag" && prev.category === "tag") ||
      (candidate.category === "classics-genre" &&
        prev.category === "classics-genre");
    if (samePair) return true;
    /* Theme-family adjacency — block any two rows whose category
       falls in the same family from sitting back-to-back. This is
       what stops a "PC Action" row landing immediately after a
       "PS2 Action Classics" or a "tag: Open World" row. The
       shuffler degrades gracefully (accepts a violation rather
       than infinite-looping) when no compliant placement is
       available, so widening the rule can't deadlock. */
    if (
      themeFamily(candidate.category) === "theme" &&
      themeFamily(prev.category) === "theme"
    ) {
      return true;
    }
    /* Two portrait-card rows back-to-back read as a single visual
       block and break the home page's horizontal rhythm. Spread the
       6-ish vertical-card rows out by treating same-orientation
       adjacency as a violation regardless of category. */
    if (candidate.isVertical && prev.isVertical) return true;
    /* Same-platform spread — Popular PS2 next to PS2 RPG Classics
       next to PS2 Action Classics reads as a "PS2 block" even when
       the categories differ (classics-platform vs classics-genre).
       Reject any two rows that surface the same platform from
       sitting next to each other. */
    if (
      candidate.platform &&
      prev.platform &&
      candidate.platform === prev.platform
    ) {
      return true;
    }
    /* Classics-platform spread — look back classicsPlatformGap slots
       so PS1/PS2/PS3 popular rows don't clump (different platforms
       still benefit from breathing room even though the same-platform
       rule above already keeps identical ones apart). */
    if (candidate.category === "classics-platform") {
      const lookBack = list.slice(-classicsPlatformGap);
      if (lookBack.some((r) => r.category === "classics-platform")) {
        return true;
      }
    }
    return false;
  };

  while (queue.length > 0) {
    /* Find the first queue entry that doesn't violate the
       adjacency constraints. If none, accept queue[0] (we've
       exhausted alternatives — better to violate than infinite
       loop). */
    let pickIdx = -1;
    for (let i = 0; i < queue.length; i++) {
      if (!isViolation(queue[i], out)) {
        pickIdx = i;
        break;
      }
    }
    if (pickIdx === -1) pickIdx = 0;
    const [picked] = queue.splice(pickIdx, 1);
    out.push(picked);
  }

  return out;
}
