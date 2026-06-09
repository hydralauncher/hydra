import {
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { useNavigate, useLocation } from "react-router-dom";

import { SkeletonTheme } from "react-loading-skeleton";

import { Hero } from "@renderer/components";
import type { HeroCandidate } from "@renderer/components/hero/hero";
import type {
  CatalogueSearchPayload,
  CatalogueSearchResult,
  DownloadSource,
  GameRepack,
  LibraryGame,
  ShopAssets,
  UserFriend,
} from "@types";

import { CatalogueCategory } from "@shared";
import {
  useLibrary,
  useAppDispatch,
  useAppSelector,
  useUserDetails,
} from "@renderer/hooks";
import { useCatalogue } from "@renderer/hooks/use-catalogue";
import { useLaunchboxFilters } from "@renderer/hooks/use-launchbox-filters";
import { clearFilters, setFilters, setMode } from "@renderer/features";
import { platformToSystem } from "@renderer/helpers";
import type { HomeRowGame } from "./home-game-card";
import { HomeRow } from "./home-row";
import { PersonalizedTitle } from "./personalized-title";
import { HomeFriendsProvider } from "./home-friends-context";
import { HomeScrollStateContext } from "./home-scroll-state-context";
import { LernaPromoCard } from "./lerna-promo-card";
import lernaLogo from "@renderer/assets/lerna-logo.svg?url";
import { PlatformTitle } from "./platform-title";
import { MOCK_PS2_GAMES, MOCK_PS3_GAMES } from "./mock-classics";
import { fetchSteamSpyTopTags } from "./steamspy-tags";
import {
  readHomeCache,
  readHomeCacheMany,
  writeHomeCache,
  type HomeCacheKey,
} from "./home-cache";
import {
  shuffleWithSeparation,
  makeRng,
  type HomeRowSpec,
} from "./home-row-shuffle";
import { HomeHydrationContext } from "./home-hydration-context";
import "./home.scss";

/* ─── Persistent Home memory ─────────────────────────────────────
   Module-level so it survives Home's unmount when the user navigates
   to another route. Restored on the next mount.

   `sessionSeed` lives here too. It seeds every row's shuffle, so if
   it changed on each mount the user would see a completely different
   set of games each time they navigated back to Home — defeating the
   point of the cache. Persisting it for the lifetime of the app
   process means the same launch shows the same picks, but a fresh
   app open re-rolls them. */
/** Module-level flag — flips to `true` the first time Home mounts in
 *  this renderer process. Used to skip the row entrance-stagger on
 *  every subsequent remount (e.g. Library → Home roundtrip) so the
 *  user doesn't sit through a 30-row × 60ms cascade (≈2s gap) every
 *  time they navigate back. The first launch still gets the nice
 *  cascading fade-in. Reset only when the renderer process restarts
 *  (= true fresh launch). */
let hasMountedHomeBefore = false;

const homeScrollMemory: {
  scrollTop: number;
  visibleTier: number;
  sessionSeed: number;
} = {
  scrollTop: 0,
  visibleTier: 0,
  /* Initialised to 0 so refreshSessionSeedIfStale() always picks
     a real value on the first Home mount. We can't rely solely on
     this Math.random() initializer because the module isn't
     reloaded on tray-minimise + reopen — Hydra defaults to
     minimise-to-tray on window close, so the renderer process can
     stay alive across what looks to the user like an "app open".
     The localStorage-backed staleness check below handles that case
     by re-rolling whenever Home reopens more than STALE_MS after
     the last mount. */
  sessionSeed: 0,
};

/** Re-roll the sessionSeed when more than this much time has passed
 *  since the last Home mount WITHIN the same renderer process —
 *  catches tray-reopen and long-idle returns. Fresh-launch detection
 *  is handled separately via sessionStorage (see below) so users
 *  always see a reshuffled Home on a new Hydra launch regardless of
 *  how quickly they relaunched. Set per the spec
 *  "refresh > 30 minutes && on launch" — either condition triggers
 *  a reshuffle, neither alone keeps the rows locked. */
const SESSION_SEED_IDLE_MS = 30 * 60 * 1000;
/** localStorage entry — survives Hydra restart. Stores the seed +
 *  the timestamp of the last Home mount. Drives the tray-reopen /
 *  long-idle re-roll window. */
const SESSION_SEED_LS_KEY = "hydra:home:session-seed";
/** sessionStorage entry — cleared when the renderer process exits
 *  (i.e. when the user actually quits Hydra). Its sole purpose is
 *  "is this a fresh launch or a navigation within an existing
 *  launch?" — absent means fresh launch and we ALWAYS re-roll, no
 *  matter how recent the localStorage timestamp is. This is what
 *  finally surfaces the "every-launch reshuffle" behaviour the user
 *  asked for in the plan; the prior 30-min staleness window meant a
 *  quick close+reopen reused the seed and the user kept seeing the
 *  same rows in the same order. */
const SESSION_SEED_SS_KEY = "hydra:home:session-seed-active";

interface PersistedSessionSeed {
  seed: number;
  ts: number;
}

/** Decides whether to keep the persisted seed or re-roll, then
 *  writes the chosen seed + timestamp back to localStorage and marks
 *  sessionStorage so the next mount knows we're mid-session.
 *
 *  Re-roll triggers (any one):
 *    1. sessionStorage marker is absent → fresh Hydra launch.
 *    2. localStorage entry missing / malformed → first run.
 *    3. localStorage timestamp older than SESSION_SEED_IDLE_MS →
 *       user came back from a long idle or a tray-reopen.
 *
 *  Returns the chosen seed AND whether it was just re-rolled — the
 *  latter lets the caller reset scroll state for the "fresh session"
 *  case (the user has been away long enough that landing on the same
 *  scroll position no longer makes sense). */
function refreshSessionSeedIfStale(): { seed: number; wasFresh: boolean } {
  const now = Date.now();

  /* Step 1 — fresh-launch detection. sessionStorage is wiped when
     the renderer process exits, so an absent marker means "the user
     has restarted Hydra (or this is the very first run)" — we
     ALWAYS re-roll on a fresh launch regardless of how recent the
     localStorage timestamp is. */
  let inSession = false;
  try {
    inSession = sessionStorage.getItem(SESSION_SEED_SS_KEY) === "1";
  } catch {
    /* sessionStorage unavailable — treat as fresh launch (safer). */
  }

  /* Step 2 — load the persisted seed (only used when in-session). */
  let last: PersistedSessionSeed | null = null;
  try {
    const raw = localStorage.getItem(SESSION_SEED_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedSessionSeed;
      if (typeof parsed?.seed === "number" && typeof parsed?.ts === "number") {
        last = parsed;
      }
    }
  } catch {
    /* localStorage unavailable / parse failure — fall through to roll. */
  }

  const isFreshLaunch = !inSession;
  const isLongIdle = !last || now - last.ts > SESSION_SEED_IDLE_MS;
  /* Per refined spec: BOTH conditions must hold to re-roll. Fresh
     launch alone (quick close+reopen) keeps the seed. Long idle
     within an existing session (mid-session navigation after >30
     min) also keeps the seed — only when the user actually relaunches
     Hydra AFTER the 30-min window does the Home tab reshuffle.
     Tray-reopen never triggers a re-roll (sessionStorage marker
     stays set across tray hide/show). */
  const shouldReroll = isFreshLaunch && isLongIdle;

  let seed: number;
  if (shouldReroll) {
    /* Combine Math.random() with the wall clock so two near-
       simultaneous launches still get distinct seeds. */
    seed =
      (Math.floor(Math.random() * 1_000_000_000) ^ now ^ (now >>> 16)) >>> 0;
    if (seed === 0) seed = 1; /* PRNG needs non-zero */
  } else {
    seed = last!.seed;
  }

  try {
    localStorage.setItem(
      SESSION_SEED_LS_KEY,
      JSON.stringify({ seed, ts: now })
    );
  } catch {
    /* best effort */
  }
  try {
    sessionStorage.setItem(SESSION_SEED_SS_KEY, "1");
  } catch {
    /* best effort */
  }

  return { seed, wasFresh: shouldReroll };
}

/* ─── Constants ─────────────────────────────────────────────────── */
const MAX_ROW_GAMES = 16;
/** Deeper pool than the visible 16-per-row count so dedup + library
 *  exclude + shuffle still leaves 16 *unique* games per row even when
 *  several rows in the same tier are pulling from overlapping data
 *  (which the catalogue API does for related popular-game queries).
 *  Bumped from 64 → 96 to reduce visible repeats further down a tier. */
const FETCH_SIZE = 96;
const CLASSICS_FETCH_SIZE = 128;
/** Below this, a discovery row triggers pool-relaxation fallback. */
const POOL_RELAX_THRESHOLD = 8;
const REFETCH_THROTTLE_MS = 2 * 60 * 1000;
const SURPRISE_SKELETON_MS = 520;
const RESHUFFLE_SCROLL_MS = 420;
const SEED_MASK = 0xffffffff;
/** Number of distinct lazy-load tiers. Each tier is a 10-row slice
 *  of the unified ordered row list (tier 0 = rows 0-9, tier 1 =
 *  rows 10-19, tier 2 = rows 20-29, tier 3 = rows 30-39). A
 *  dedicated IntersectionObserver per tier-boundary sentinel bumps
 *  `visibleTier` as the user scrolls down, which is what gates the
 *  per-tier DATA FETCHES (network throttling — see secondary
 *  useEffects gated on `visibleTier >= N`). The row SCAFFOLDS for
 *  every tier render up-front so the user never sees a black gap. */
const MAX_TIER = 3;
/** First-row index of each tier. Used to position in-list sentinels
 *  (one per tier boundary) so each tier's data fetches start when
 *  the user scrolls toward that tier, not before, and not only when
 *  they reach the very bottom of the page. */
const TIER_START_INDICES = [0, 10, 20, 30] as const;
/** Hard target for the total number of rendered rows per refresh.
 *  Bumped from 30 → 40 per the user spec. The pool is expected to
 *  exceed this; for a brand-new install without personal rows the
 *  pool is still ~45, comfortably above 40. */
const TARGET_ROW_COUNT = 40;
/** Approximate number of rows that should render as portrait-card
 *  shelves per refresh. The actual list is picked from the pool by
 *  the sessionSeed-driven Fisher-Yates below, so the SAME rows
 *  aren't always vertical — orientation rolls afresh on every
 *  refresh just like everything else seeded by sessionSeed. */
const VERTICAL_ROW_COUNT_PER_REFRESH = 7;

/** The 6 "anchor" rows the user requires to always land within the
 *  first 12 positions of the home tab. The anchors don't take fixed
 *  slots — they shuffle alongside 6 non-anchor rows so the user can
 *  see a different top-of-home on every refresh, but always with
 *  these 6 included. */
const FIRST_12_ANCHOR_KEYS = new Set<string>([
  "hot",
  "weekly",
  "randomPicks",
  "mostPlayedHydra",
  "recentlyPlayed",
  "topReviewed",
]);
/** Number of slots in the "top window" the anchors must fall within. */
const TOP_WINDOW_SIZE = 12;

/* Every Home row participates in the unified shuffle as one of these.
 * Same `id`/`category` contract as `HomeRowSpec` from
 * `home-row-shuffle.ts`, plus the row's render function. The render
 * receives the row's `animationDelay` so the entrance-stagger still
 * works across the shuffled order. */
interface OrderedRowSpec extends HomeRowSpec {
  render: (delay: number) => React.ReactNode;
}
/** Cutoff year for the "Retro & Old-School" row: PC games released on
 *  or before this year are eligible. Combined client-side with
 *  classicsGames (which are always retro by definition). */
const RETRO_PC_BEFORE_YEAR = 2010;

/* JSX order of the genre rows that get personalised — used by the
   greedy seed-assignment routine to decide which row each library
   game claims. The first matching unclaimed genre in this list wins,
   so order corresponds to the order rows appear on the page. */
const PERSONALIZED_GENRE_ORDER = [
  "Action",
  "Indie",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Horror",
  "Racing",
  "Sports",
  "Puzzle",
  "Casual",
  "Massively Multiplayer",
  "Fighting",
  "Platformer",
] as const;

/* Tag rows surfaced from the catalogue. Each row has its own theme. */
const TAG_ROWS = [
  { key: "openWorld", tag: "Open World" },
  { key: "storyRich", tag: "Story Rich" },
  { key: "coOp", tag: "Co-op" },
  { key: "soulsLike", tag: "Souls-like" },
  { key: "roguelite", tag: "Rogue-lite" },
  { key: "pixelArt", tag: "Pixel Graphics" },
  { key: "sciFi", tag: "Sci-fi" },
  { key: "fantasy", tag: "Fantasy" },
  { key: "survival", tag: "Survival" },
] as const;

/* Steam's "genres" taxonomy is small and doesn't include some labels
   the UI surfaces as if they were genres. Puzzle / Fighting /
   Platformer are USER TAGS on Steam, not genres, so a
   `genres: ["Puzzle"]` query returns an empty (or mixed) row and a
   See All click lands on a catalogue page with no effective filter.
   Map these pseudo-genres to their tag-name counterpart so:
     • The row fetch can resolve them via tag IDs (same path the
       tag rows already use), filling the row with actual matching
       games.
     • The See All button can route through goToTag() instead of
       passing an invalid genre filter to the catalogue. */
const PSEUDO_GENRE_TAGS: Record<string, string> = {
  Puzzle: "Puzzle",
  Fighting: "Fighting",
  Platformer: "Platformer",
  /* Horror isn't an official Steam catalogue genre — it's a popular
     tag. The earlier `{ genres: ["Horror"] }` catalogue search was
     coming back empty (and the catalogue's See-All redirect with
     that filter showed an unfiltered list) because the value isn't
     a recognised genre on the backend. Mapping it to the "Horror"
     tag here means the row fetches via `{ tags: [horrorTagId] }`
     instead, which IS a real catalogue filter. The See-All click
     in the row spec now routes through `goToTag("Horror")` to
     match. */
  Horror: "Horror",
};

/* Spotlight presets — each session picks ONE of these based on
   sessionSeed and surfaces it as a "Spotlight" row. The user sees a
   different curated theme per launch instead of the same static row.
   Each entry pairs a translation key with the catalogue search
   filter that defines the theme. Filter values must be ones the API
   actually accepts (genres list is fine; tags would need ID
   resolution so we stay on genres + sortBy here). */
const SPOTLIGHTS = [
  {
    key: "actionRpg",
    titleKey: "spotlight_action_rpg",
    filter: { genres: ["Action", "RPG"] },
  },
  {
    key: "strategySim",
    titleKey: "spotlight_strategy_sim",
    filter: { genres: ["Strategy", "Simulation"] },
  },
  {
    key: "horrorAdventure",
    titleKey: "spotlight_horror_adventure",
    filter: { genres: ["Horror", "Adventure"] },
  },
  {
    key: "cozyIndie",
    titleKey: "spotlight_cozy_indie",
    filter: { genres: ["Casual", "Indie"] },
  },
  {
    key: "racingSports",
    titleKey: "spotlight_racing_sports",
    filter: { genres: ["Racing", "Sports"] },
  },
  {
    key: "highScored",
    titleKey: "spotlight_high_scored",
    filter: { sortBy: "reviewScore", sortOrder: "desc", genres: ["Indie"] },
  },
] as const;

/* ─── Helpers ─────────────────────────────────────────────────── */
const keyOf = (g: { shop: string; objectId: string }) =>
  `${g.shop}:${g.objectId}`;

/** Hash a string + base seed into a per-row PRNG seed. */
function hashRowKey(rowKey: string, baseSeed: number): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < rowKey.length; i++) {
    h = Math.imul(h ^ rowKey.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** Randomly pick n distinct items from arr using a seeded PRNG.
 *  Preserves the picked items' original relative order. */
function pickN<T>(arr: T[], n: number, seed: number): T[] {
  if (arr.length <= n) return arr.slice();
  const indices = Array.from({ length: arr.length }, (_, i) => i);
  const rng = makeRng(seed);
  /* Fisher-Yates on indices */
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => arr[i]);
}

/** Derive a series-key from a game title so different entries in
 *  the same franchise collapse to the same bucket. Strips the
 *  subtitle (anything after a colon), Roman numerals, and trailing
 *  Arabic numbers used as installment markers — so "The Witcher 3:
 *  Wild Hunt", "The Witcher 2: Assassins of Kings", and "Witcher 4"
 *  all map to "the witcher". An empty string means "no series
 *  signal", in which case the diversity filter doesn't constrain. */
function seriesKey(title: string): string {
  if (!title) return "";
  let s = title.split(":")[0];
  s = s.replace(/\b([IVX]+|\d+)\b/gi, " ");
  s = s.replace(/[^\w\s]/g, " ");
  s = s.trim().replace(/\s+/g, " ").toLowerCase();
  return s;
}

/** Diversity-aware pick. Same shuffle as pickN, but the first pass
 *  caps each title-series at one game so the row doesn't fill up
 *  with three Persona / Far Cry / Yakuza entries. Anything skipped
 *  on the first pass moves to an overflow list and is appended only
 *  if the row still has room — so on a narrow pool the diversity
 *  rule degrades to filling repeats instead of leaving the row half
 *  empty. The seeded shuffle keeps picks reproducible per-row per-
 *  session, matching the sessionSeed-driven freshness already in
 *  place. */
function pickNDiverse<T extends { title: string }>(
  arr: T[],
  n: number,
  seed: number
): T[] {
  if (arr.length <= n) return arr.slice();
  const indices = Array.from({ length: arr.length }, (_, i) => i);
  const rng = makeRng(seed);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const picked: T[] = [];
  const pickedIndices: number[] = [];
  const overflow: { item: T; idx: number }[] = [];
  const seriesCount = new Map<string, number>();

  for (const idx of indices) {
    if (picked.length >= n) break;
    const item = arr[idx];
    const sk = seriesKey(item.title);
    if (sk && (seriesCount.get(sk) ?? 0) >= 1) {
      overflow.push({ item, idx });
      continue;
    }
    picked.push(item);
    pickedIndices.push(idx);
    if (sk) seriesCount.set(sk, (seriesCount.get(sk) ?? 0) + 1);
  }

  /* Top up with overflow items (already filtered for repeats by
     series); preserves shuffle order. */
  for (const { item, idx } of overflow) {
    if (picked.length >= n) break;
    picked.push(item);
    pickedIndices.push(idx);
  }

  /* Preserve original relative order in the final output so rows
     that visually depend on the source array's ordering (e.g. the
     popularity-sorted Most Played list) still feel ranked rather
     than randomised. */
  return pickedIndices
    .map((idx, outIdx) => ({ idx, item: picked[outIdx] }))
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.item);
}

/* ─── Converters ─────────────────────────────────────────────────── */
const apiGameToRowGame = (g: ShopAssets): HomeRowGame => ({
  objectId: g.objectId,
  shop: g.shop,
  title: g.title,
  libraryImageUrl: g.libraryImageUrl,
  libraryHeroImageUrl: g.libraryHeroImageUrl,
  coverImageUrl: g.coverImageUrl,
  logoImageUrl: g.logoImageUrl,
  downloadSources: g.downloadSources,
});

const catalogueToRowGame = (g: CatalogueSearchResult): HomeRowGame => ({
  objectId: g.objectId,
  shop: g.shop,
  title: g.title,
  libraryImageUrl: g.libraryImageUrl,
  downloadSources: g.downloadSources,
  platform: g.platform,
  genres: g.genres,
});

/** Sentinel returned when libraryGameToRowGame is handed an
 *  undefined/null input — empty objectId means downstream dedup
 *  collapses it on first sight, so it never reaches a card. Lets us
 *  keep the function signature `LibraryGame → HomeRowGame` (no
 *  changes at the 13 call sites) while making the function itself
 *  crash-proof against transiently-stale library arrays. */
const EMPTY_ROW_GAME: HomeRowGame = {
  objectId: "",
  shop: "steam",
  title: "",
};

const libraryGameToRowGame = (g: LibraryGame): HomeRowGame => {
  /* Defensive guard — `library` can briefly carry undefined slots
     while a slice/filter is mid-update (observed when a stale
     /home/search result was still in flight on Home remount). Without
     this, `g.objectId` throws and the whole renderer greys out. */
  if (!g || typeof g !== "object") return EMPTY_ROW_GAME;
  return {
    objectId: g.objectId,
    shop: g.shop,
    title: g.title,
    libraryImageUrl: g.libraryImageUrl,
    libraryHeroImageUrl: g.libraryHeroImageUrl,
    coverImageUrl: g.coverImageUrl,
    logoImageUrl: g.logoImageUrl,
    downloadSources: g.downloadSources,
    platform: g.platform,
    /* Pass library-derived fields through so the Recently Played row's
       dedicated card variant can render playtime + achievement progress.
       Discovery rows ignore these (the standard HomeGameCard doesn't
       read them). */
    playTimeInMilliseconds: g.playTimeInMilliseconds,
    achievementCount: g.achievementCount,
    unlockedAchievementCount: g.unlockedAchievementCount,
    lastTimePlayed: g.lastTimePlayed,
  };
};

/* ─── Catalogue search payload builder ─────────────────────────── */
/* Mirrors the shape the Catalogue page sends so the staging API
   accepts modern queries. NOTE: `shops` and `platforms` are
   intentionally OMITTED from the defaults — the staging /catalogue
   /search returns HTTP 400 for modern queries that include an empty
   `shops: []` or `platforms: []` array (catalogue.tsx destructures
   `platforms` out for modern queries and never sets `shops` for
   modern, which is why its filter sidebar works). Classics callers
   add them explicitly via overrides (`shops: ["launchbox"]` +
   `platforms: [key]`). */
const buildSearch = (
  overrides: Record<string, unknown>,
  sourceIds: string[]
) => ({
  title: "",
  sortBy: "popularity",
  sortOrder: "desc",
  take: FETCH_SIZE,
  skip: 0,
  downloadSourceIds: sourceIds,
  tags: [],
  publishers: [],
  genres: [],
  developers: [],
  protondbSupportBadges: [],
  deckCompatibility: [],
  downloadSourceFingerprints: [],
  ...overrides,
});

/* ─── Component ──────────────────────────────────────────────────── */
export default function Home() {
  const { t } = useTranslation("home");
  const { library: libraryRaw } = useLibrary();
  /* Sanitise once — every downstream useMemo derives from `library`
     so a single guard here removes the need to defensively re-check
     at the 20+ filter/map/sort call sites further down. Sparse-array
     holes or undefined entries (observed when /home/search is mid-
     flight on Home remount) would otherwise reach the field-access
     in filter callbacks (`!g.isDeleted`) and crash the renderer with
     a grey screen. */
  const library = useMemo(
    () =>
      (libraryRaw ?? []).filter(
        (g): g is LibraryGame => !!g && typeof g === "object"
      ),
    [libraryRaw]
  );
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const location = useLocation();

  /* Launchbox filters — needed to resolve PS1/PS2/PS3 to their proper
     filter KEYS (the raw `platform` string on classics games is the name,
     not the key the catalogue expects). */
  const launchboxFilters = useLaunchboxFilters(true);

  /* Sign-in state — gates the Friends Playing row (and could gate other
     social features later). Null when signed-out. */
  const { userDetails } = useUserDetails();

  /* Populate steamUserTags / steamGenres maps in Redux so the tag rows
     can resolve names → numeric IDs (the catalogue payload requires IDs
     for `tags: number[]`; passing names crashes the Catalogue page when
     it tries to reverse-look-them up). */
  useCatalogue();
  const steamUserTags = useAppSelector(
    (state) => state.catalogueSearch.steamUserTags
  );

  /** Resolve a Steam tag name (e.g. "Open World") to its numeric tag ID
   *  (e.g. 1695). The hardcoded tag names used throughout Home are in
   *  English, so we ALWAYS look them up in the English map — picking the
   *  current-language map first would fail on every non-English locale
   *  (its keys are localized) and silently break tag See-All + every
   *  tag row fetch. The resulting ID is language-agnostic, so the
   *  catalogue page renders the localized label correctly. */
  const lookupTagId = useCallback(
    (tagName: string): number | null => {
      const map = steamUserTags["en"];
      if (!map) return null;
      const id = map[tagName];
      return typeof id === "number" ? id : null;
    },
    [steamUserTags]
  );

  /* ── Session seed — resolved once per Home mount via a lazy
        useState initializer. We can't compute this at module-load
        time (line 77's homeScrollMemory) because Hydra minimises
        to tray on window close, so the renderer process — and the
        module — stays alive across what users perceive as "I
        closed Hydra and reopened it". The localStorage-backed
        staleness check inside refreshSessionSeedIfStale() handles
        that case by re-rolling whenever Home reopens more than 30
        minutes after the last mount.

        useState's lazy initializer (the function form) runs
        exactly once per component mount — same shape as useMemo
        with deps=[] but with cleaner semantics for "compute once,
        no React render-cycle re-entrancy". The whole body is
        wrapped in try/catch as belt-and-braces: even if
        localStorage is somehow unavailable in the current Electron
        context, Home still renders with a fallback seed instead
        of crashing to a grey screen. */
  const [sessionSeed] = useState<number>(() => {
    try {
      const { seed, wasFresh } = refreshSessionSeedIfStale();
      homeScrollMemory.sessionSeed = seed;
      if (wasFresh) {
        /* "Fresh session" — landing at the previously-saved scroll
           position no longer makes sense because the row order +
           contents have changed. Reset to top. */
        homeScrollMemory.scrollTop = 0;
        homeScrollMemory.visibleTier = 0;
      }
      return seed;
    } catch (err) {
      /* Last-resort guard. refreshSessionSeedIfStale() already
         try/catches its localStorage IO, but a defensive outer
         layer means a future regression in this hot path can
         never take the whole app offline. */
      // eslint-disable-next-line no-console
      console.error("[home] sessionSeed roll failed; using fallback", err);
      const fallback =
        (Math.floor(Math.random() * 1_000_000_000) ^ Date.now()) >>> 0 || 1;
      homeScrollMemory.sessionSeed = fallback;
      return fallback;
    }
  });

  /* Pick one Spotlight preset for this session — derived from the
     seed so it stays stable across renders but rotates each launch.
     A different theme surfaces on every app open which keeps the
     row feeling fresh without baking the cadence into a state value. */
  const currentSpotlight = useMemo(
    () => SPOTLIGHTS[sessionSeed % SPOTLIGHTS.length],
    [sessionSeed]
  );

  /* ── First-mount detector ──────────────────────────────────────
        True the very first time Home mounts in this renderer process,
        false on every subsequent remount (Library → Home, etc.). Used
        downstream to skip the row entrance-stagger so returning to
        Home is instant instead of waiting through a 30-row cascade. */
  const [isFirstHomeMount] = useState(() => {
    const first = !hasMountedHomeBefore;
    hasMountedHomeBefore = true;
    return first;
  });

  /* ── Refetch token — throttled bump on navigation back to "/" ────
        Earlier every Home re-entry bumped this token unconditionally,
        which re-fired every fetch effect gated on it. Each re-fire
        could return slightly different pools (catalogue staging is
        non-deterministic across calls), and `sliceDiscovery`'s game
        picks per row are derived from those pools — so a quick
        Library → Home roundtrip silently swapped some games inside
        rows even though sessionSeed hadn't changed.

        Throttled to 2 minutes since the last bump. Quick tab toggles
        stay layout-stable; a deliberate "I've been away a while"
        return still gets fresh data. */
  const [refetchToken, setRefetchToken] = useState(0);
  const prevPathRef = useRef(location.pathname);
  const lastRefetchAtRef = useRef(0);
  useEffect(() => {
    if (prevPathRef.current !== "/" && location.pathname === "/") {
      const now = Date.now();
      if (now - lastRefetchAtRef.current > REFETCH_THROTTLE_MS) {
        lastRefetchAtRef.current = now;
        setRefetchToken((tk) => tk + 1);
      }
    }
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  /* ── Catalogue navigation helper ─────────────────────────────────
        Order matters: setMode resets filters as a side effect, so the
        actual filter values MUST be dispatched after setMode.  ────── */
  const goToCatalogue = useCallback(
    (
      mode: "modern" | "classics" = "modern",
      filters: Partial<CatalogueSearchPayload> = {}
    ) => {
      dispatch(clearFilters());
      dispatch(setMode(mode));
      if (Object.keys(filters).length > 0) {
        dispatch(setFilters(filters));
      }
      navigate("/catalogue");
    },
    [dispatch, navigate]
  );

  /* ── Download sources ────────────────────────────────────────── */
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  useEffect(() => {
    levelDBService.values("downloadSources").then((results) => {
      const sources = orderBy(results as DownloadSource[], "createdAt", "desc");
      setSourceIds(sources.map((s) => s.id));
      setSourcesLoaded(true);
    });
  }, []);

  /* ── Primary API rows ────────────────────────────────────────── */
  const [hotGames, setHotGames] = useState<HomeRowGame[]>([]);
  const [mostPlayedHydraGames, setMostPlayedHydraGames] = useState<
    HomeRowGame[]
  >([]);
  const [weeklyGames, setWeeklyGames] = useState<HomeRowGame[]>([]);
  const [topReviewedGames, setTopReviewedGames] = useState<HomeRowGame[]>([]);
  const [recentlyAddedGames, setRecentlyAddedGames] = useState<HomeRowGame[]>(
    []
  );
  const [hiddenGemsGames, setHiddenGemsGames] = useState<HomeRowGame[]>([]);
  /* Games currently being played by the user's friends. Empty when
     signed-out, when the user has no friends, or when no friend is
     actively playing right now. Fetched live from /profile/friends. */
  const [friendsPlayingGames, setFriendsPlayingGames] = useState<HomeRowGame[]>(
    []
  );
  /* Map from `${shop}:${objectId}` → list of friends currently playing
     that game. Powers the new per-card "friends playing this game"
     icon + tooltip (every game card in Home checks this map, not just
     the cards in the Friends Playing row). Populated from the same
     /profile/friends response that powers `friendsPlayingGames`. */
  const [friendsByGameKey, setFriendsByGameKey] = useState<
    Map<
      string,
      Array<{ id: string; displayName: string; profileImageUrl: string | null }>
    >
  >(new Map());

  const [isLoadingHot, setIsLoadingHot] = useState(true);
  const [isLoadingMostPlayedHydra, setIsLoadingMostPlayedHydra] =
    useState(true);
  const [isLoadingWeekly, setIsLoadingWeekly] = useState(true);
  const [isLoadingTopReviewed, setIsLoadingTopReviewed] = useState(true);
  const [isLoadingPrimary, setIsLoadingPrimary] = useState(true);

  /* ── Secondary state — populated when tiers unlock ───────────── */
  const [classicsGames, setClassicsGames] = useState<HomeRowGame[]>([]);
  /* Dedicated per-platform classics pools. classicsGames is sorted by
     popularity across all platforms and tends to be dominated by PS1,
     so client-side filtering left PS2/PS3 nearly empty. */
  const [ps1Games, setPs1Games] = useState<HomeRowGame[]>([]);
  const [ps2Games, setPs2Games] = useState<HomeRowGame[]>([]);
  const [ps3Games, setPs3Games] = useState<HomeRowGame[]>([]);
  /* Extra-platform classics — a single keyed Record covering every
     launchbox platform OTHER than PS1/PS2/PS3 (which have their own
     state hooks above for backwards-compat with the existing per-PS
     fetch / cache / spec wiring). One entry per platform key
     (`launchboxFilters.platforms[i].key`) populated by the same
     fetchClassicsRow helper PS uses, just iterated. Allows the home
     to surface "Popular {Platform} Games" rows for every platform
     the catalogue exposes — fulfilling the user's "ALL platforms the
     API supports" request without bloating the file with N discrete
     useState hooks. */
  const [extraPlatformGames, setExtraPlatformGames] = useState<
    Record<string, HomeRowGame[]>
  >({});
  /* Per-(platform, genre) classics fetches.
     Map key: `${ps}:${Genre}` (e.g. "ps2:Horror"). Backed by
     /catalogue/search with the combined {shops, platforms, genres}
     filter — staging tends not to populate g.genres on individual
     launchbox results, so the client-side title-keyword filter in
     `classicsByPlatformAndGenre` produced thin rows for PS2/PS3 even
     when plenty of on-topic games existed. Targeted per-combo
     fetches fix that without dropping the local filter (kept as
     fallback for the case where the fetch hasn't resolved yet). */
  const [
    classicsByPlatformAndGenreFetched,
    setClassicsByPlatformAndGenreFetched,
  ] = useState<Map<string, HomeRowGame[]>>(new Map());
  /* Retro PC games — catalogue results filtered to releaseYear ≤
     RETRO_PC_BEFORE_YEAR. Combined client-side with classicsGames to
     produce a mixed PC + classics row. */
  const [retroPcGames, setRetroPcGames] = useState<HomeRowGame[]>([]);
  /* Non-genre/tag discovery rows that diversify the home with signals
     beyond category filtering:
       • criticallyAcclaimed — sortBy=reviewScore (quality signal,
         distinct from topReviewed which uses Hydra's combined score)
       • brandNew — sortBy=releaseDate desc (newest by Steam release
         date, distinct from "Recently Added" which uses catalogue
         ingest date) */
  const [criticallyAcclaimedGames, setCriticallyAcclaimedGames] = useState<
    HomeRowGame[]
  >([]);
  const [brandNewGames, setBrandNewGames] = useState<HomeRowGame[]>([]);
  /* Spotlight — populated by the secondary fetch effect using whichever
     SPOTLIGHTS preset the sessionSeed picked. State is shared across
     sessions; cache key bakes in the preset key so a re-roll into a
     different preset doesn't reuse the previous one's payload. */
  const [spotlightGames, setSpotlightGames] = useState<HomeRowGame[]>([]);
  const [genreData, setGenreData] = useState<Record<string, HomeRowGame[]>>({});
  const [tagData, setTagData] = useState<Record<string, HomeRowGame[]>>({});
  /* Default to TRUE so the classics rows hold a skeleton on remount
     while cache hydration runs / the fetch effect fires. With the
     previous `useState(false)` default, the first render after a
     remount had `isLoading=false + games.length=0` which collapses to
     "hide row" — the user saw classics rows vanish on every tab
     roundtrip before either the cache or the fetch had a chance to
     populate state. Setting true forces the loading skeleton until
     the fetch's `.finally` resets it. */
  const [isLoadingClassics, setIsLoadingClassics] = useState(true);
  const [isLoadingPlatformClassics, setIsLoadingPlatformClassics] =
    useState(true);
  /* Default both to `true` so genre + tag rows hold their skeleton
     state on the very first render (before the genre / tag fetch
     effects have a chance to flip these to `true` themselves). Without
     this, those rows return null on remount until the fetch fires,
     which collapses their height and pulls scroll-restore 1-2 rows
     past the saved position. The fetch effects switch these back to
     false in their `.finally` once data lands. */
  const [isLoadingGenres, setIsLoadingGenres] = useState(true);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  /* True until the very first cache hydration completes. Drives a
     row-wide "show skeleton" flag so every HomeRow renders its
     skeleton placeholders the instant Home remounts (e.g. user
     navigates away and comes back). Without it, rows whose state
     is still []  + isLoading=false early-return to `null`, which
     collapses their height and makes the saved scrollTop land 1-2
     rows below where the user actually was. */
  const [isHydrating, setIsHydrating] = useState(true);

  /* ── Cache hydration on mount — paint instantly with last-known data ── */
  useEffect(() => {
    const genreKeys: HomeCacheKey[] = [
      "genre:Action",
      "genre:RPG",
      "genre:Adventure",
      "genre:Strategy",
      "genre:Simulation",
      "genre:Sports",
      "genre:Racing",
      "genre:Indie",
      "genre:Puzzle",
      "genre:Casual",
      "genre:Massively Multiplayer",
      "genre:Horror",
      "genre:Fighting",
      "genre:Platformer",
    ];
    const tagKeys: HomeCacheKey[] = TAG_ROWS.map(
      (r) => `tag:${r.key}` as HomeCacheKey
    );
    /* Hydrate every PS{1,2,3} × curated-genre combination. The
       combinations we care about are the ones with row specs
       downstream (see classics-genre allSpecs.push calls); listing
       them here means the rows light up immediately on remount
       instead of waiting for the per-(platform, genre) fetch to
       resolve again. */
    const psGenres = [
      "Action",
      "Adventure",
      "RPG",
      "Horror",
      "Platformer",
      "Fighting",
      "Racing",
    ];
    const psPlatforms: Array<"ps1" | "ps2" | "ps3"> = ["ps1", "ps2", "ps3"];
    const classicsPgKeys: HomeCacheKey[] = [];
    for (const ps of psPlatforms) {
      for (const g of psGenres) {
        classicsPgKeys.push(`classics:${ps}:${g}` as HomeCacheKey);
      }
    }
    readHomeCacheMany([
      "popular",
      "mostPlayedHydra",
      "weekly",
      "topReviewed",
      "recentlyAdded",
      "hiddenGems",
      "classics",
      "ps1",
      "ps2",
      "ps3",
      "retroPc",
      "criticallyAcclaimed",
      "brandNew",
      `spotlight:${currentSpotlight.key}`,
      ...genreKeys,
      ...tagKeys,
      ...classicsPgKeys,
    ]).then((cache) => {
      if (cache.popular) {
        setHotGames(cache.popular);
        setIsLoadingHot(false);
      }
      if (cache.mostPlayedHydra) {
        setMostPlayedHydraGames(cache.mostPlayedHydra);
        setIsLoadingMostPlayedHydra(false);
      }
      if (cache.weekly) {
        setWeeklyGames(cache.weekly);
        setIsLoadingWeekly(false);
      }
      if (cache.topReviewed) {
        setTopReviewedGames(cache.topReviewed);
        setIsLoadingTopReviewed(false);
      }
      if (cache.recentlyAdded || cache.hiddenGems) {
        if (cache.recentlyAdded) setRecentlyAddedGames(cache.recentlyAdded);
        if (cache.hiddenGems) setHiddenGemsGames(cache.hiddenGems);
        setIsLoadingPrimary(false);
      }
      if (cache.classics) setClassicsGames(cache.classics);
      /* Per-platform classics — hydrate independently so PS1/PS2/PS3
         rows survive a Home → Catalogue → Home roundtrip even when
         the catalogue's per-platform fetch comes back empty
         (staging). The fetch effect still runs on every refetch
         token and only overwrites the cache when it returns data
         (stale-while-revalidate). */
      if (cache.ps1) setPs1Games(cache.ps1);
      if (cache.ps2) setPs2Games(cache.ps2);
      if (cache.ps3) setPs3Games(cache.ps3);
      if (cache.retroPc) setRetroPcGames(cache.retroPc);
      if (cache.criticallyAcclaimed)
        setCriticallyAcclaimedGames(cache.criticallyAcclaimed);
      if (cache.brandNew) setBrandNewGames(cache.brandNew);
      const spotlightCached = cache[`spotlight:${currentSpotlight.key}`];
      if (spotlightCached) setSpotlightGames(spotlightCached);

      const seededGenres: Record<string, HomeRowGame[]> = {};
      for (const k of genreKeys) {
        const v = cache[k];
        if (v) seededGenres[k.replace("genre:", "")] = v;
      }
      if (Object.keys(seededGenres).length > 0) setGenreData(seededGenres);

      const seededTags: Record<string, HomeRowGame[]> = {};
      for (const k of tagKeys) {
        const v = cache[k];
        if (v) seededTags[k.replace("tag:", "")] = v;
      }
      if (Object.keys(seededTags).length > 0) setTagData(seededTags);

      /* Seed the per-(platform, genre) map from cached results.
         The runtime fetch effect below will overwrite stale-while-
         revalidate. */
      const seededClassicsPg = new Map<string, HomeRowGame[]>();
      for (const k of classicsPgKeys) {
        const v = cache[k];
        if (v && v.length > 0) {
          seededClassicsPg.set(k.replace("classics:", ""), v);
        }
      }
      if (seededClassicsPg.size > 0) {
        setClassicsByPlatformAndGenreFetched(seededClassicsPg);
      }

      /* Flip the global hydration flag once the initial cache pass
         has finished — every HomeRow's `isLoading` is OR'd with
         this in the JSX, so rows that didn't hit the cache fall
         straight into their fetch-driven loading state without
         flashing an empty section in between. */
      setIsHydrating(false);
    });
  }, []);

  /* ── Fetchers ──────────────────────────────────────────────── */
  /* The bare GET — used directly only inside fetchCatalogueRow below. */
  const fetchCatalogueRowRaw = useCallback(
    (category: CatalogueCategory, ids: string[]) =>
      window.electron.hydraApi
        .get<ShopAssets[]>(`/catalogue/${category}`, {
          params: { take: FETCH_SIZE, skip: 0, downloadSourceIds: ids },
          needsAuth: false,
        })
        .catch(() => [] as ShopAssets[]),
    []
  );

  /* Wrapped fetcher with un-gated relaxation. If the source-filtered
     request returns too few games (often because the user has limited
     download sources configured), retry with no source filter and merge
     unique entries. Ensures hot/weekly/topReviewed never come back empty
     when there's any data in the catalogue at all — which matters
     because every genre/tag row falls back to hotGames. */
  const fetchCatalogueRow = useCallback(
    async (category: CatalogueCategory, ids: string[]) => {
      const primary = await fetchCatalogueRowRaw(category, ids);
      if (primary.length >= POOL_RELAX_THRESHOLD || ids.length === 0) {
        return primary;
      }
      const fallback = await fetchCatalogueRowRaw(category, []);
      const seen = new Set(primary.map((g) => `${g.shop}:${g.objectId}`));
      for (const g of fallback) {
        const k = `${g.shop}:${g.objectId}`;
        if (!seen.has(k)) {
          primary.push(g);
          seen.add(k);
        }
      }
      return primary;
    },
    [fetchCatalogueRowRaw]
  );

  const postSearch = useCallback(
    <T,>(body: Record<string, unknown>) =>
      window.electron.hydraApi
        .post<{ edges: T[]; count: number }>("/catalogue/search", {
          data: body,
          needsAuth: false,
        })
        .then((r) => r.edges)
        .catch(() => [] as T[]),
    []
  );

  /* Classics-specific fetch with un-gated relaxation. Tries up to
     THREE shapes per call to maximise the chance of getting on-topic
     content out of a partially-cooperative staging endpoint:
       1. `{shops:["launchbox"], take, ...extra, downloadSourceIds:ids}`
          — canonical shape used by the catalogue page.
       2. Same body with `downloadSourceIds:[]` if (1) was thin
          (users with limited launchbox-matching sources).
       3. `{platforms:[key], take, downloadSourceIds:[]}` — drops the
          `shops:["launchbox"]` constraint, used as a last resort
          when (1) and (2) both came back empty for a per-platform
          query. Some staging environments 400 on the combined
          {shops, platforms} filter even though they accept each
          alone; this third attempt unblocks PS2/PS3 in that
          environment. Results are post-filtered to launchbox-shop
          games so non-classics noise doesn't leak in. */
  const fetchClassicsRow = useCallback(
    async (extra: Record<string, unknown>, ids: string[]) => {
      const body = {
        shops: ["launchbox"],
        take: CLASSICS_FETCH_SIZE,
        ...extra,
      };
      const primary = await postSearch<CatalogueSearchResult>(
        buildSearch(body, ids)
      );
      const accumulator = [...primary];
      const seen = new Set(primary.map(keyOf));
      const addUnique = (list: CatalogueSearchResult[]) => {
        for (const g of list) {
          const k = keyOf(g);
          if (!seen.has(k)) {
            seen.add(k);
            accumulator.push(g);
          }
        }
      };

      /* (2) Drop source filter if the gated fetch was thin. */
      if (accumulator.length < POOL_RELAX_THRESHOLD && ids.length > 0) {
        const fallback = await postSearch<CatalogueSearchResult>(
          buildSearch(body, [])
        );
        addUnique(fallback);
      }

      /* (3) Drop `shops:["launchbox"]` for per-platform queries that
         still came back empty. Re-issue with platforms-only filter,
         then client-side filter to launchbox shop to keep classics
         purity. Only fires when extra.platforms is present — broad
         classics fetches don't benefit from dropping the shops
         constraint (they'd pull in all-shop popular games). */
      if (
        accumulator.length < POOL_RELAX_THRESHOLD &&
        Array.isArray(extra.platforms) &&
        (extra.platforms as unknown[]).length > 0
      ) {
        const noShops = {
          take: CLASSICS_FETCH_SIZE,
          platforms: extra.platforms,
        };
        const platformOnly = await postSearch<CatalogueSearchResult>(
          buildSearch(noShops, [])
        );
        addUnique(platformOnly.filter((g) => g.shop === "launchbox"));
      }

      return accumulator;
    },
    [postSearch]
  );

  /* Fetch one PC discovery row with source-gate. If the filtered fetch
     comes back thinner than POOL_RELAX_THRESHOLD, top it up with an
     un-gated fetch so rows never collapse into empty space.
     Source-matched games come first (their badges render directly); the
     un-gated games appended after inherit badges via the cross-row
     enrichSources cache where possible, or render bare otherwise. */
  const fetchPcDiscoveryRow = useCallback(
    async (body: Record<string, unknown>, ids: string[]) => {
      const primary = await postSearch<CatalogueSearchResult>(
        buildSearch(body, ids)
      );
      if (primary.length >= POOL_RELAX_THRESHOLD || ids.length === 0) {
        return primary;
      }
      const fallback = await postSearch<CatalogueSearchResult>(
        buildSearch(body, [])
      );
      const seen = new Set(primary.map(keyOf));
      for (const g of fallback) {
        const k = keyOf(g);
        if (!seen.has(k)) {
          primary.push(g);
          seen.add(k);
        }
      }
      return primary;
    },
    [postSearch]
  );

  /* ── Primary rows fetch ─────────────────────────────────────── */
  useEffect(() => {
    if (!sourcesLoaded) return;

    /* Stale-while-revalidate helper: only swap in the fresh payload
       when it's non-empty, so a transient empty/error response doesn't
       blank a previously-loaded row. */
    const swrSet = <T extends HomeRowGame[]>(
      setter: (v: T) => void,
      rows: T,
      cacheKey: HomeCacheKey
    ) => {
      if (rows.length > 0) {
        setter(rows);
        writeHomeCache(cacheKey, rows);
      }
    };

    fetchCatalogueRow(CatalogueCategory.Hot, sourceIds)
      .then((g) => swrSet(setHotGames, g.map(apiGameToRowGame), "popular"))
      .catch(() => {})
      .finally(() => setIsLoadingHot(false));

    /* Most Played on Hydra — sorted by hydraScore (Hydra's combined
       engagement signal — the user-facing proxy for "what people
       actually play"). `playerCount` was rejected by the API with a
       400; it isn't one of the accepted sortBy values per the
       CatalogueSearchPayload type. */
    const mostPlayedPromise = fetchPcDiscoveryRow(
      { sortBy: "hydraScore", sortOrder: "desc" },
      sourceIds
    );
    mostPlayedPromise
      .then((games) =>
        swrSet(
          setMostPlayedHydraGames,
          games.map(catalogueToRowGame),
          "mostPlayedHydra"
        )
      )
      .finally(() => setIsLoadingMostPlayedHydra(false));

    fetchCatalogueRow(CatalogueCategory.Weekly, sourceIds)
      .then((g) => swrSet(setWeeklyGames, g.map(apiGameToRowGame), "weekly"))
      .catch(() => {})
      .finally(() => setIsLoadingWeekly(false));

    fetchCatalogueRow(CatalogueCategory.Achievements, sourceIds)
      .then((g) =>
        swrSet(setTopReviewedGames, g.map(apiGameToRowGame), "topReviewed")
      )
      .catch(() => {})
      .finally(() => setIsLoadingTopReviewed(false));

    Promise.all([
      fetchPcDiscoveryRow(
        { sortBy: "releaseDate", sortOrder: "desc" },
        sourceIds
      ),
      fetchPcDiscoveryRow(
        { sortBy: "reviewScore", sortOrder: "desc" },
        sourceIds
      ),
      mostPlayedPromise,
    ])
      .then(([recent, acclaimed, popular]) => {
        swrSet(
          setRecentlyAddedGames,
          recent.map(catalogueToRowGame),
          "recentlyAdded"
        );
        const popularKeys = new Set(popular.map(keyOf));
        const gems = acclaimed.filter((g) => !popularKeys.has(keyOf(g)));
        swrSet(setHiddenGemsGames, gems.map(catalogueToRowGame), "hiddenGems");
      })
      .finally(() => setIsLoadingPrimary(false));
  }, [
    fetchCatalogueRow,
    fetchPcDiscoveryRow,
    sourceIds,
    sourcesLoaded,
    refetchToken,
  ]);

  /* ── Friends Playing Now ──────────────────────────────────────
        Pulls the user's friends list and surfaces the `currentGame`
        of each friend who's actively in a session. Only fetched when
        signed-in; bails on sign-out. Re-runs on navigation refresh. */
  useEffect(() => {
    if (!userDetails) {
      setFriendsPlayingGames([]);
      setFriendsByGameKey(new Map());
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    params.append("take", "50");
    params.append("skip", "0");
    params.append("shop", "steam");
    params.append("shop", "launchbox");

    window.electron.hydraApi
      .get<{ totalFriends: number; friends: UserFriend[] }>(
        `/profile/friends?${params.toString()}`
      )
      .then((response) => {
        if (cancelled) return;
        /* Build TWO maps in a single pass:
             1. `byKey` — unique HomeRowGame per game (the row's source)
             2. `friendsByGame` — every friend playing each game (drives
                the per-card icon + tooltip across the whole Home tab) */
        const byKey = new Map<string, HomeRowGame>();
        const friendsByGame = new Map<
          string,
          Array<{
            id: string;
            displayName: string;
            profileImageUrl: string | null;
          }>
        >();
        for (const friend of response.friends) {
          const g = friend.currentGame;
          if (!g) continue;
          const key = `${g.shop}:${g.objectId}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              objectId: g.objectId,
              shop: g.shop,
              title: g.title,
              libraryImageUrl: g.libraryImageUrl,
              libraryHeroImageUrl: g.libraryHeroImageUrl,
              coverImageUrl: g.coverImageUrl,
              logoImageUrl: g.logoImageUrl,
              downloadSources: g.downloadSources,
            });
          }
          const list = friendsByGame.get(key) ?? [];
          list.push({
            id: friend.id,
            displayName: friend.displayName,
            profileImageUrl: friend.profileImageUrl,
          });
          friendsByGame.set(key, list);
        }
        setFriendsPlayingGames(Array.from(byKey.values()));
        setFriendsByGameKey(friendsByGame);
      })
      .catch(() => {
        setFriendsPlayingGames([]);
        setFriendsByGameKey(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [userDetails, refetchToken]);

  /* ── Surprise Me row reshuffle ──────────────────────────────
        Drives the "Surprise me" row's 12 seeded picks. Every click on
        the title-button bumps `surpriseSeed` — the memo below re-runs
        and the user sees 12 fresh games. We also briefly raise
        `surpriseLoading`, which is forwarded to HomeRow as
        `isLoading=true` for ~520ms so the row drops to its skeleton
        state during the swap, mirroring the lazy-load feel that
        normal rows have when they first come into view. The duration
        is short enough that the reshuffle still feels snappy but long
        enough to land a perceptible skeleton frame. */
  const [surpriseSeed, setSurpriseSeed] = useState<number>(
    () => (Math.random() * SEED_MASK) | 0
  );
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  /* Monotonic counter bumped on every Reshuffle. Forwarded to the
     row's `scrollResetSignal` so HomeRow knows to smoothly scroll
     back to slot 0 of the freshly-rolled picks. A counter (instead
     of e.g. `surpriseSeed` itself) keeps the signal stable across
     unrelated re-renders that DON'T mean "reshuffle just fired". */
  const [surpriseScrollSignal, setSurpriseScrollSignal] = useState(0);
  const surpriseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Scroll-animation timer — fires when the row has finished
     smooth-scrolling its OLD cards back to slot 0, at which point
     we re-roll the seed + show the skeleton + queue the new
     cards. Keeping the old cards visible during the scroll is what
     gives the user the "slots sliding to first position" effect
     they asked for; without this delay the seed bumped
     synchronously with the scroll signal, isLoading flipped to
     true on the same render, and the row's cards swapped to
     skeletons instantly — the smooth scroll then animated empty
     skeleton placeholders left, not actual cards. */
  const reshuffleSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  /* Duration of the row's smooth-scroll-to-0 animation. Kept in
     loose sync with browser default for `scrollTo({behavior:
     "smooth"})` plus a small buffer — matches the chevron-spin
     length too (titleRefreshSpin 0.5s), so the visual cycle of
     "icon spins / cards slide back / new cards appear" reads as
     a single fluid action. */
  const handleReshuffle = useCallback(() => {
    /* 1. Bump the scroll signal NOW. HomeRow's scrollResetSignal
          effect smooth-scrolls the existing cards back to slot 0. */
    setSurpriseScrollSignal((n) => n + 1);
    /* 2. After the scroll animation completes, swap in the new
          picks. */
    if (reshuffleSwapTimerRef.current) {
      clearTimeout(reshuffleSwapTimerRef.current);
    }
    reshuffleSwapTimerRef.current = setTimeout(() => {
      reshuffleSwapTimerRef.current = null;
      setSurpriseSeed((Math.random() * SEED_MASK) | 0);
      setSurpriseLoading(true);
      if (surpriseTimeoutRef.current) clearTimeout(surpriseTimeoutRef.current);
      surpriseTimeoutRef.current = setTimeout(
        () => setSurpriseLoading(false),
        SURPRISE_SKELETON_MS
      );
    }, RESHUFFLE_SCROLL_MS);
  }, []);
  useEffect(
    () => () => {
      if (surpriseTimeoutRef.current) clearTimeout(surpriseTimeoutRef.current);
      if (reshuffleSwapTimerRef.current)
        clearTimeout(reshuffleSwapTimerRef.current);
    },
    []
  );

  /* ── Tiered progressive scroll ──────────────────────────────── */
  /* Lazy tier progression: only tier 0 fetches fire at mount; tier
     1/2/3 each unlock when the user scrolls toward the FIRST row of
     that tier (a dedicated in-list sentinel per tier triggers the
     bump — see `TIER_START_INDICES` + the per-sentinel observer
     effect below). Keeps low-end PCs from being slammed with the
     full 40-row fetch surge at cold start.

     Restored from persistent memory so Home → Catalogue → Home
     re-mounts with the same tier already loaded, which is what
     lets `homeScrollMemory.scrollTop` restore reliably. */
  const [visibleTier, setVisibleTier] = useState<number>(
    () => homeScrollMemory.visibleTier
  );
  /* Single "load next tier" sentinel. Lives AFTER the last currently-
     rendered row (NOT at a fixed JSX position) so it's always present
     in the DOM while there are more tiers to unlock. When it scrolls
     within the lookahead distance of the viewport bottom, visibleTier
     bumps by one and the next 10 rows get mounted. The previous
     approach (one fixed-position sentinel per tier) had a chicken-
     and-egg bug once row mounting became tier-sliced: the sentinel
     for tier 1 only existed if row 10 was already rendered, but row
     10 only mounted after tier 1 unlocked. */
  const nextTierSentinelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement>(null);

  /* Persist visibleTier whenever it changes. */
  useEffect(() => {
    homeScrollMemory.visibleTier = visibleTier;
  }, [visibleTier]);

  /* Restore scroll position on mount.

     The challenge: even after row heights stabilise via the
     isHydrating skeleton path, individual rows can still grow
     after first paint as async data lands (friends-playing,
     classics, deep tier fetches, etc.). If any of that growth
     happens ABOVE the saved scrollTop, the saved value lands on
     a different row than where the user actually was.

     Strategy: pin the scroll position aggressively for a 2s
     window after mount. Reapply at rAF, then again on every
     ResizeObserver tick whenever the content height changes
     (rows mounting). Bail the moment the user scrolls themselves.

     A ref-guarded `userInterrupted` flag is intentionally raised
     ONLY by user-driven scroll inputs (wheel/touch/mousedown),
     NOT by our own programmatic `scrollTop =` writes. Those
     writes fire scroll events too — we have to ignore them or
     the restore would cancel itself the moment it succeeds. */
  useLayoutEffect(() => {
    const saved = homeScrollMemory.scrollTop;
    if (saved <= 0) return;
    const el = contentRef.current;
    if (!el) return;

    let userInterrupted = false;
    const onUserScroll = () => {
      userInterrupted = true;
    };
    el.addEventListener("wheel", onUserScroll, { passive: true });
    el.addEventListener("touchstart", onUserScroll, { passive: true });
    el.addEventListener("mousedown", onUserScroll);

    const apply = () => {
      if (userInterrupted || !contentRef.current) return;
      if (contentRef.current.scrollTop !== saved) {
        contentRef.current.scrollTop = saved;
      }
    };

    /* First apply: rAF gives the DOM one frame to layout. */
    const rafId = requestAnimationFrame(apply);

    /* Re-apply whenever the content height changes during the
       restoration window. Most async row mounts (cache hydration
       finishing, friends-playing data landing, tier-gated fetches)
       grow scrollHeight; ResizeObserver fires for each, we
       re-pin scrollTop to the saved value. Stops after the
       window ends OR on user scroll. */
    const ro = new ResizeObserver(() => {
      if (userInterrupted) return;
      apply();
    });
    ro.observe(el);
    /* Also observe the immediate inner content so we catch the
       Hero / individual row resizes without waiting for the
       browser to bubble them up to the scroll container. */
    for (const child of Array.from(el.children)) {
      if (child instanceof HTMLElement) ro.observe(child);
    }

    /* Backup time-based reapplies for cases the observer misses
       (rare in modern browsers but cheap insurance). */
    const t1 = setTimeout(apply, 100);
    const t2 = setTimeout(apply, 500);
    const t3 = setTimeout(apply, 1200);

    /* Tear down the restoration window after 2 seconds. The
       passive scrollTop-save effect (below) takes over from here. */
    const tEnd = setTimeout(() => {
      ro.disconnect();
      el.removeEventListener("wheel", onUserScroll);
      el.removeEventListener("touchstart", onUserScroll);
      el.removeEventListener("mousedown", onUserScroll);
    }, 2000);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(tEnd);
      ro.disconnect();
      el.removeEventListener("wheel", onUserScroll);
      el.removeEventListener("touchstart", onUserScroll);
      el.removeEventListener("mousedown", onUserScroll);
    };
  }, []);

  /* ── Scroll-idle bus ────────────────────────────────────────────
        Backs `HomeScrollStateContext`. Each row's IntersectionObserver
        callback consults `isScrollingRef.current` synchronously to
        decide whether to apply `setRowInView` immediately or defer
        it to the next scroll-idle drain. Deferring eliminates the
        Layerize bursts the DevTools trace pinned as the dominant
        "not 100 % fluid" cost — classics-blur cards otherwise mount/
        unmount mid-scroll and each transition creates / destroys its
        own GPU compositor layer.

        The same flag also drives `.home__content--scrolling` (CSS
        hover-suppression) and the scrollTop persistence the page
        already had. All three pieces are owned by the single scroll
        listener so we only attach one. */
  const isScrollingRef = useRef<boolean>(false);
  const scrollIdleSubscribersRef = useRef<Set<() => void>>(new Set());
  const subscribeToScrollIdle = useCallback((cb: () => void) => {
    scrollIdleSubscribersRef.current.add(cb);
    return () => {
      scrollIdleSubscribersRef.current.delete(cb);
    };
  }, []);
  const homeScrollState = useMemo(
    () => ({
      isScrollingRef,
      subscribe: subscribeToScrollIdle,
    }),
    [subscribeToScrollIdle]
  );

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    /* Scroll-active state — drives `.home__content--scrolling` which
       suppresses card hover transitions while the user is actively
       scrolling. Re-added after windowing landed: the original cost
       (style invalidation across ~7,500 nodes at 40 rows × hundreds
       of cards) no longer applies — windowing caps mounted cards to
       ~30–60, so the descendant walk is small. The benefit (zero
       :hover firing on every card the cursor sweeps across during
       vertical scroll) is now net positive. Class is removed 150ms
       after the last scroll tick so hover snaps back smoothly. */
    let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      /* Persist whatever the user is currently looking at —
         INCLUDING zero — so back-to-top followed by navigation
         away brings them back to the top. The restoration
         useLayoutEffect snapshots the value at mount-time into
         a local `saved` so any racy "scroll handler fires
         before restore" save can't trash the target. */
      homeScrollMemory.scrollTop = el.scrollTop;

      /* Flip "is scrolling" → true synchronously so the very next
         IntersectionObserver callback in the same task batch
         already sees the truthful flag. */
      isScrollingRef.current = true;
      if (!el.classList.contains("home__content--scrolling")) {
        el.classList.add("home__content--scrolling");
      }
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
      scrollEndTimeout = setTimeout(() => {
        el.classList.remove("home__content--scrolling");
        scrollEndTimeout = null;
        isScrollingRef.current = false;
        /* Drain all subscribers — each HomeRow flushes its pending
           rowInView change here. Snapshot the set to a list so a
           callback that unsubscribes mid-drain can't perturb the
           iteration. */
        for (const cb of Array.from(scrollIdleSubscribersRef.current)) {
          cb();
        }
      }, 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
      el.classList.remove("home__content--scrolling");
      isScrollingRef.current = false;
    };
  }, []);

  /* Single "load next tier" sentinel — observes `nextTierSentinelRef`
     which lives in the JSX immediately after the last currently-
     rendered row. When the sentinel enters the lookahead zone, bump
     visibleTier; the next tier's rows render → the sentinel jumps
     to the new bottom → cycle continues until MAX_TIER.
     4000px lookahead gives even hard-flick scrolls enough warning
     to mount the next tier before the user scrolls past the current
     one (avoiding the historical "black gap" regression). */
  useEffect(() => {
    if (visibleTier >= MAX_TIER) return;
    const content = contentRef.current;
    const el = nextTierSentinelRef.current;
    if (!content || !el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleTier((prev) => Math.min(MAX_TIER, prev + 1));
        }
      },
      { root: content, threshold: 0.01, rootMargin: "0px 0px 4000px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleTier]);

  /* ── Secondary fetches — kick off when tier 1 unlocks, refetch when
        the navigation token bumps ─────────────────────────────────── */
  /* Gate key encodes both refetchToken AND whether launchbox platform
     filters have loaded. The broad classics fetch below uses platform
     keys to fire per-platform PS2/PS3 queries; if it ran ONCE with
     filters not yet loaded, we want it to run AGAIN once they arrive
     so the platform-specific batches get a chance. Two effective
     runs per refetchToken — one early (filters missing), one late
     (filters present) — instead of a single early run that misses
     PS2/PS3 forever. */
  const lastSecondaryFetchToken = useRef<string>("");
  useEffect(() => {
    /* Fetch on mount instead of waiting for tier 1 to unlock. Gating
       on `visibleTier >= 1` previously meant every tier-1+ row
       (classics, tags, per-platform) sat on skeletons until the user
       scrolled near them AND the fetch completed — that's why some
       rows loaded instantly (tier 0 cached) while others took
       multiple seconds to populate. Starting all fetches on mount
       trades a one-time burst of concurrent requests for a much
       more consistent loading experience: by the time the user
       scrolls into any tier-1+ row, its data has typically already
       resolved. */
    if (!sourcesLoaded) return;
    const filtersReady = launchboxFilters.platforms.length > 0;
    const gateKey = `${refetchToken}:${filtersReady ? "1" : "0"}`;
    if (lastSecondaryFetchToken.current === gateKey) return;
    lastSecondaryFetchToken.current = gateKey;

    /* Broad classics fetch — popularity-sorted is heavily dominated by
       PS1 because PS1 has the longest backlog of "popular" titles in
       the catalogue. To surface PS2 & PS3 titles in the broad pool
       (and thus in the per-platform classics rows that fall back to
       client-side filtering when the dedicated per-platform fetch
       comes back empty), run several parallel fetches that walk
       different axes of the catalogue: popularity pages 1+2+3, plus
       — when launchbox platform keys have loaded — explicit
       per-platform queries for PS2 and PS3 right inside the same
       effect. This is BELT-AND-SUSPENDERS over the separate
       per-platform effect below: paginated popularity walks deeper
       into staging's ranked list (where PS2/PS3 live in the long
       tail), AND the parallel platform fetches force on-platform
       content into the union even if popularity pages skew PS1. */
    const platformsList = launchboxFilters.platforms;
    const findKeyForBroad = (system: "ps1" | "ps2" | "ps3") =>
      platformsList.find((p) => platformToSystem(p.name) === system)?.key ??
      null;
    const ps2KeyBroad = findKeyForBroad("ps2");
    const ps3KeyBroad = findKeyForBroad("ps3");

    setIsLoadingClassics(true);
    Promise.all([
      fetchClassicsRow({}, sourceIds),
      fetchClassicsRow({ skip: CLASSICS_FETCH_SIZE }, sourceIds),
      fetchClassicsRow({ skip: CLASSICS_FETCH_SIZE * 2 }, sourceIds),
      ps2KeyBroad
        ? fetchClassicsRow({ platforms: [ps2KeyBroad] }, sourceIds)
        : Promise.resolve([] as CatalogueSearchResult[]),
      ps3KeyBroad
        ? fetchClassicsRow({ platforms: [ps3KeyBroad] }, sourceIds)
        : Promise.resolve([] as CatalogueSearchResult[]),
    ])
      .then((batches) => {
        const seen = new Set<string>();
        const merged: HomeRowGame[] = [];
        const ingest = (list: CatalogueSearchResult[]) => {
          for (const g of list) {
            const k = keyOf(g);
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(catalogueToRowGame(g));
          }
        };
        for (const b of batches) ingest(b);
        if (merged.length > 0) {
          setClassicsGames(merged);
          writeHomeCache("classics", merged);
        }
        /* Eagerly promote the per-platform PS2/PS3 batches into their
           dedicated state too — saves the separate per-platform effect
           below from being the only path that can populate these. */
        const ps2Rows = batches[3].map(catalogueToRowGame);
        const ps3Rows = batches[4].map(catalogueToRowGame);
        if (ps2Rows.length > 0) {
          setPs2Games(ps2Rows);
          writeHomeCache("ps2", ps2Rows);
        }
        if (ps3Rows.length > 0) {
          setPs3Games(ps3Rows);
          writeHomeCache("ps3", ps3Rows);
        }
      })
      .finally(() => setIsLoadingClassics(false));

    /* Retro PC fetch — PC catalogue games released on or before the
       RETRO_PC_BEFORE_YEAR cutoff. Combined client-side with
       classicsGames to populate the "Retro & Old-School" row with a
       mix of pre-2010 PC titles and emulator-era classics. */
    fetchPcDiscoveryRow(
      { releaseYear: { lte: RETRO_PC_BEFORE_YEAR } },
      sourceIds
    ).then((games) => {
      const rows = games.map(catalogueToRowGame);
      if (rows.length > 0) {
        setRetroPcGames(rows);
        writeHomeCache("retroPc", rows);
      }
    });

    /* Critically Acclaimed — sortBy=reviewScore. Different signal
       from "Top Reviewed" (which uses Hydra's combined score) — this
       row pulls games rated highest by users without weighting in
       popularity / download counts. */
    fetchPcDiscoveryRow(
      { sortBy: "reviewScore", sortOrder: "desc" },
      sourceIds
    ).then((games) => {
      const rows = games.map(catalogueToRowGame);
      if (rows.length > 0) {
        setCriticallyAcclaimedGames(rows);
        writeHomeCache("criticallyAcclaimed", rows);
      }
    });

    /* Brand New Releases — sortBy=releaseDate desc. Distinct from
       "Recently Added" (which is sorted by catalogue ingest date, so
       it can surface old games newly added to the catalogue). This
       row is strictly by Steam release date. */
    fetchPcDiscoveryRow(
      { sortBy: "releaseDate", sortOrder: "desc" },
      sourceIds
    ).then((games) => {
      const rows = games.map(catalogueToRowGame);
      if (rows.length > 0) {
        setBrandNewGames(rows);
        writeHomeCache("brandNew", rows);
      }
    });

    /* Spotlight — fetches whichever SPOTLIGHTS preset the session
       picked. Cache key includes the preset key so a different
       session's payload doesn't pollute this one. */
    fetchPcDiscoveryRow(currentSpotlight.filter, sourceIds).then((games) => {
      const rows = games.map(catalogueToRowGame);
      if (rows.length > 0) {
        setSpotlightGames(rows);
        writeHomeCache(`spotlight:${currentSpotlight.key}`, rows);
      }
    });

    const genreList = [
      "Action",
      "RPG",
      "Adventure",
      "Strategy",
      "Simulation",
      "Sports",
      "Racing",
      "Indie",
      "Puzzle",
      "Casual",
      "Massively Multiplayer",
      "Horror",
      "Fighting",
      "Platformer",
    ];
    setIsLoadingGenres(true);
    /* Tag-name → ID map for the pseudo-genre branch below. The
       genre fetch fires before steamUserTags arrives sometimes
       (the latter loads async via use-catalogue), so we tolerate
       the map being empty here — pseudo-genres without a resolved
       ID temporarily fall back to genre-name search, then re-fire
       once the tags load. */
    const tagMap = steamUserTags["en"] ?? {};
    Promise.all(
      genreList.map((genre) => {
        const pseudoTagName = PSEUDO_GENRE_TAGS[genre];
        const search: Partial<CatalogueSearchPayload> =
          pseudoTagName && typeof tagMap[pseudoTagName] === "number"
            ? { tags: [tagMap[pseudoTagName]] }
            : { genres: [genre] };
        return fetchPcDiscoveryRow(search, sourceIds).then((games) => {
          const rows = games.map(catalogueToRowGame);
          /* Only persist a non-empty result so an empty/failing refetch
             doesn't wipe a previously-cached good payload. */
          if (rows.length > 0) writeHomeCache(`genre:${genre}`, rows);
          return [genre, rows] as const;
        });
      })
    )
      .then((entries) => {
        /* Stale-while-revalidate: merge into existing state and keep the
           previous payload for any row whose refetch came back empty.
           Prevents rows from briefly loading then vanishing if the API
           returns 0 for a tag/genre. */
        setGenreData((prev) => {
          const next = { ...prev };
          for (const [g, rows] of entries) {
            if (rows.length > 0) next[g] = rows;
          }
          return next;
        });
      })
      .finally(() => setIsLoadingGenres(false));

    /* Tag-themed rows fetch in a separate effect because they depend on
       the steamUserTags map being loaded first to resolve names → IDs. */
  }, [
    visibleTier,
    sourcesLoaded,
    sourceIds,
    postSearch,
    fetchPcDiscoveryRow,
    fetchClassicsRow,
    refetchToken,
    launchboxFilters,
    /* Added so this effect re-fires once the tag map arrives —
       pseudo-genre rows (Puzzle/Fighting/Platformer) need it to
       resolve their tag IDs and produce a themed row instead of a
       generic genre-search miss. */
    steamUserTags,
  ]);

  /* ── Tag-themed row fetches ───────────────────────────────
        Waits for the steamUserTags map so names can be resolved to
        numeric IDs (the catalogue payload requires IDs and the
        catalogue page also reverse-looks them up — passing names
        returns empty AND would crash the Catalogue when reached
        via See All). Re-fires when the map arrives. */
  const lastTagFetchKeyRef = useRef<string>("");
  useEffect(() => {
    /* Tag-row fetches now fire on mount (same reasoning as the
       classics-broad effect above): the previous tier-1 gate made
       tag-themed rows the slowest to populate because they only
       started fetching after the user scrolled to them. */
    if (!sourcesLoaded) return;
    /* TAG_ROWS uses English names → MUST look up in the English map.
       The current-language map's keys are localized and wouldn't match,
       which would make every tag fetch return 0 on non-English locales
       and silently fall through to the universal pool. */
    const map = steamUserTags["en"];
    if (!map || Object.keys(map).length === 0) return;

    const fetchKey = `${refetchToken}:en`;
    if (lastTagFetchKeyRef.current === fetchKey) return;
    lastTagFetchKeyRef.current = fetchKey;

    setIsLoadingTags(true);
    Promise.all(
      TAG_ROWS.map(({ key, tag }) => {
        const tagId = map[tag];
        if (typeof tagId !== "number") {
          /* Tag name doesn't exist in the map — skip without
             clobbering any cached payload. */
          return Promise.resolve([key, [] as HomeRowGame[]] as const);
        }
        return fetchPcDiscoveryRow({ tags: [tagId] }, sourceIds).then(
          (games) => {
            const rows = games.map(catalogueToRowGame);
            if (rows.length > 0) writeHomeCache(`tag:${key}`, rows);
            return [key, rows] as const;
          }
        );
      })
    )
      .then((entries) => {
        setTagData((prev) => {
          const next = { ...prev };
          for (const [k, rows] of entries) {
            if (rows.length > 0) next[k] = rows;
          }
          return next;
        });
      })
      .finally(() => setIsLoadingTags(false));
  }, [
    visibleTier,
    sourcesLoaded,
    sourceIds,
    refetchToken,
    steamUserTags,
    fetchPcDiscoveryRow,
  ]);

  /* ── Per-platform classics fetches ────────────────────────
     Dedicated PS1/PS2/PS3 searches so each row gets real platform-
     specific data instead of being dominated by PS1 (which floods the
     popularity-sorted all-classics fetch). Runs once launchbox filter
     keys are loaded. */
  const lastPlatformFetchTokenRef = useRef<number>(-1);
  useEffect(() => {
    /* Per-platform classics (PS1/PS2/PS3) fetch on mount instead of
       waiting for tier 1. Same reasoning as the broader classics +
       tag effects above — guarantees the dedicated per-platform rows
       populate without the user having to scroll to trigger them. */
    if (!sourcesLoaded) return;
    if (launchboxFilters.platforms.length === 0) return;
    if (lastPlatformFetchTokenRef.current === refetchToken) return;
    lastPlatformFetchTokenRef.current = refetchToken;

    const findKey = (system: "ps1" | "ps2" | "ps3") =>
      launchboxFilters.platforms.find(
        (p) => platformToSystem(p.name) === system
      )?.key ?? null;

    const ps1Key = findKey("ps1");
    const ps2Key = findKey("ps2");
    const ps3Key = findKey("ps3");

    const fetchPlatform = (key: string | null) =>
      key
        ? fetchClassicsRow({ platforms: [key] }, sourceIds)
        : Promise.resolve([] as CatalogueSearchResult[]);

    setIsLoadingPlatformClassics(true);
    Promise.all([
      fetchPlatform(ps1Key),
      fetchPlatform(ps2Key),
      fetchPlatform(ps3Key),
    ])
      .then(([ps1, ps2, ps3]) => {
        const r1 = ps1.map(catalogueToRowGame);
        const r2 = ps2.map(catalogueToRowGame);
        const r3 = ps3.map(catalogueToRowGame);
        /* Stale-while-revalidate per platform, with cache writes so
           the rows survive a nav-roundtrip (Home → Catalogue → Home
           remounts the page and the per-platform fetch can return 0
           in staging — without the cache the rows would vanish). */
        if (r1.length > 0) {
          setPs1Games(r1);
          writeHomeCache("ps1", r1);
        }
        if (r2.length > 0) {
          setPs2Games(r2);
          writeHomeCache("ps2", r2);
        }
        if (r3.length > 0) {
          setPs3Games(r3);
          writeHomeCache("ps3", r3);
        }
      })
      .finally(() => setIsLoadingPlatformClassics(false));
  }, [
    visibleTier,
    sourcesLoaded,
    sourceIds,
    launchboxFilters,
    fetchClassicsRow,
    refetchToken,
  ]);

  /* ── Per-(platform, genre) classics fetch ────────────────────────
        Targets the PS{1,2,3} × curated-genre matrix. Each combo
        produces a dedicated /catalogue/search call with
        `{shops:["launchbox"], platforms:[psKey], genres:[g]}` — the
        OpenAPI spec confirms the catalogue accepts both filters
        together and the existing `fetchClassicsRow` already issues
        exactly that shape with its un-gated source-id fallback.

        Without this, the classics-genre rows pulled their data from
        the client-side `classicsByPlatformAndGenre` filter, which
        depended on per-game `genres` being populated in the broader
        per-platform fetch response — staging often doesn't return
        that field for launchbox results, so PS2/PS3 genre rows came
        back near-empty even when the catalogue clearly had the
        on-topic titles. Per-combo fetches make those rows real.

        Gated on tier 3 (classics live there) and refetchToken; the
        dedupe key prevents per-render re-firing. Stale-while-
        revalidate writes to both the map state AND the levelDB
        cache so the rows hydrate instantly on next mount. */
  const lastClassicsPgKeyRef = useRef<string>("");
  useEffect(() => {
    if (!sourcesLoaded) return;
    if (visibleTier < 3) return;
    if (launchboxFilters.platforms.length === 0) return;

    const findKey = (system: "ps1" | "ps2" | "ps3") =>
      launchboxFilters.platforms.find(
        (p) => platformToSystem(p.name) === system
      )?.key ?? null;
    const psKeys: Record<"ps1" | "ps2" | "ps3", string | null> = {
      ps1: findKey("ps1"),
      ps2: findKey("ps2"),
      ps3: findKey("ps3"),
    };
    const psGenres = [
      "Action",
      "Adventure",
      "RPG",
      "Horror",
      "Platformer",
      "Fighting",
      "Racing",
    ];
    const fetchKey = `${refetchToken}:${psKeys.ps1 ?? ""}:${psKeys.ps2 ?? ""}:${psKeys.ps3 ?? ""}`;
    if (lastClassicsPgKeyRef.current === fetchKey) return;
    lastClassicsPgKeyRef.current = fetchKey;

    let cancelled = false;
    const combos: Array<{
      ps: "ps1" | "ps2" | "ps3";
      key: string;
      genre: string;
    }> = [];
    for (const ps of ["ps1", "ps2", "ps3"] as const) {
      const key = psKeys[ps];
      if (!key) continue;
      for (const g of psGenres) combos.push({ ps, key, genre: g });
    }
    Promise.all(
      combos.map(async ({ ps, key, genre }) => {
        const rows = await fetchClassicsRow(
          { platforms: [key], genres: [genre] },
          sourceIds
        );
        return [`${ps}:${genre}`, rows.map(catalogueToRowGame)] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setClassicsByPlatformAndGenreFetched((prev) => {
        const next = new Map(prev);
        for (const [k, rows] of entries) {
          /* Stale-while-revalidate — only overwrite when this fetch
             actually returned data. */
          if (rows.length > 0) {
            next.set(k, rows);
            writeHomeCache(`classics:${k}` as HomeCacheKey, rows);
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    visibleTier,
    sourcesLoaded,
    sourceIds,
    launchboxFilters,
    fetchClassicsRow,
    refetchToken,
  ]);

  /* ── Extra-platform classics fetch ────────────────────────────
        Walks every launchbox platform OTHER than PS1/PS2/PS3 (which
        have their own fetch above) and fires fetchClassicsRow per
        platform key. Results land in the keyed `extraPlatformGames`
        record so the row-builder downstream can emit one "Popular
        {Platform} Games" row per populated entry. Platforms whose
        fetch returns empty are simply omitted from the record — the
        downstream loop renders nothing for them, which is what the
        user's "skip if no way" constraint asks for. */
  const lastExtraPlatformsKeyRef = useRef<string>("");
  useEffect(() => {
    if (!sourcesLoaded) return;
    if (launchboxFilters.platforms.length === 0) return;
    /* Identify the "extra" platforms: anything launchbox exposes that
       isn't already PS1/PS2/PS3. We use `platformToSystem` to detect
       the PS ones (which the existing fetch already handles). */
    const extras = launchboxFilters.platforms.filter(
      (p) => platformToSystem(p.name) === null
    );
    if (extras.length === 0) return;
    /* Dedupe key so the effect doesn't re-fetch on every render — it
       only re-fetches when the platform list itself changes or the
       refetch token bumps. */
    const fetchKey = `${refetchToken}:${extras.map((p) => p.key).join(",")}`;
    if (lastExtraPlatformsKeyRef.current === fetchKey) return;
    lastExtraPlatformsKeyRef.current = fetchKey;

    let cancelled = false;
    Promise.all(
      extras.map(async (platform) => {
        const rows = await fetchClassicsRow(
          { platforms: [platform.key] },
          sourceIds
        );
        return [platform.key, rows.map(catalogueToRowGame)] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setExtraPlatformGames((prev) => {
        const next = { ...prev };
        for (const [key, rows] of entries) {
          /* Stale-while-revalidate — only overwrite when the fetch
             returned data, so a transient empty response doesn't
             collapse a row that was previously populated. */
          if (rows.length > 0) next[key] = rows;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    sourcesLoaded,
    sourceIds,
    launchboxFilters,
    fetchClassicsRow,
    refetchToken,
  ]);

  /* ── Per-library-game source lookup ────────────────────────
     Many library games have no `downloadSources` stored on them
     (added before sources were configured, or shop mismatch).
     Fetch sources for those games directly via the per-game
     endpoint so library cards always show badges when matches
     exist. Capped + batched. */
  const [librarySourcesCache, setLibrarySourcesCache] = useState<
    Map<string, string[]>
  >(new Map());

  useEffect(() => {
    if (!sourcesLoaded || sourceIds.length === 0) return;

    /* Target library games that don't already have sources, that we
       haven't fetched yet, and that aren't classics (launchbox uses
       its own download flow and doesn't surface external sources). */
    const targets = library
      .filter(
        (g) =>
          !g.isDeleted &&
          g.shop !== "launchbox" &&
          (!g.downloadSources || g.downloadSources.length === 0) &&
          !librarySourcesCache.has(g.objectId)
      )
      .slice(0, 100);

    if (targets.length === 0) return;

    let cancelled = false;
    Promise.all(
      targets.map(async (game) => {
        try {
          const repacks = await window.electron.hydraApi.get<GameRepack[]>(
            `/games/${game.shop}/${game.objectId}/download-sources`,
            {
              params: { take: 100, skip: 0, downloadSourceIds: sourceIds },
              needsAuth: false,
            }
          );
          const names = Array.from(
            new Set(
              repacks
                .map((r) => r.downloadSourceName)
                .filter((n): n is string => !!n)
            )
          );
          return [game.objectId, names] as const;
        } catch {
          return [game.objectId, [] as string[]] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setLibrarySourcesCache((prev) => {
        const next = new Map(prev);
        for (const [id, names] of entries) {
          /* Store even empty arrays so we don't refetch on every render. */
          next.set(id, names);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
    /* librarySourcesCache intentionally omitted — we mutate via the
       setter only, and including it here would trigger re-fetch loops. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, sourcesLoaded, sourceIds, refetchToken]);

  /* ── Source-enrichment cache ─────────────────────────────────
     Indexed by `shop:objectId` AND raw `objectId` so library games
     whose shop differs from the catalogue version still get enriched. */
  const sourcesCache = useMemo(() => {
    const m = new Map<string, string[]>();
    const ingest = (games: HomeRowGame[]) => {
      for (const g of games) {
        if (g.downloadSources && g.downloadSources.length > 0) {
          m.set(keyOf(g), g.downloadSources);
          m.set(g.objectId, g.downloadSources);
        }
      }
    };
    ingest(hotGames);
    ingest(mostPlayedHydraGames);
    ingest(weeklyGames);
    ingest(topReviewedGames);
    ingest(recentlyAddedGames);
    ingest(hiddenGemsGames);
    ingest(classicsGames);
    for (const arr of Object.values(genreData)) ingest(arr);
    for (const arr of Object.values(tagData)) ingest(arr);

    /* Merge per-library-game lookups last so they fill in any games the
       catalogue rows didn't cover. */
    for (const [objectId, sources] of librarySourcesCache) {
      if (sources.length > 0 && !m.has(objectId)) {
        m.set(objectId, sources);
      }
    }

    return m;
  }, [
    hotGames,
    mostPlayedHydraGames,
    weeklyGames,
    topReviewedGames,
    recentlyAddedGames,
    hiddenGemsGames,
    classicsGames,
    genreData,
    tagData,
    librarySourcesCache,
  ]);

  /* Backfill `downloadSources` on any game where the field is missing
     or empty using whatever the catalogue rows already brought in. This
     covers both library rows AND discovery rows where the same game
     appears in a fetched row with sources but the displayed copy came
     from a fetch that didn't carry source data. */
  const enrichSources = useCallback(
    (games: HomeRowGame[]): HomeRowGame[] =>
      games.map((g) => {
        if (g.downloadSources && g.downloadSources.length > 0) return g;
        const cached =
          sourcesCache.get(keyOf(g)) ?? sourcesCache.get(g.objectId);
        return cached ? { ...g, downloadSources: cached } : g;
      }),
    [sourcesCache]
  );
  const enrichLibraryRow = enrichSources;

  /* ── Universal fallback pool ─────────────────────────────────
     Union of every tier-0 source (deduped). Used as the LAST-RESORT
     fallback for genre/tag rows so a row whose own fetch genuinely
     returned 0 games (staging, sparse API responses, missing genre
     mapping) still has *something* to show instead of vanishing.

     Critically, the slice-discovery logic only consults this pool
     when the row's own `games` array is empty — once a genre/tag
     fetch returned data, we stay on-topic for that row, allowing
     repeats from its own games rather than leaking popular/hot
     titles into every themed slot. */
  const universalPool = useMemo(() => {
    const pool: HomeRowGame[] = [];
    const seenIds = new Set<string>();
    const ingest = (games: HomeRowGame[]) => {
      for (const g of games) {
        const k = keyOf(g);
        if (seenIds.has(k)) continue;
        seenIds.add(k);
        pool.push(g);
      }
    };
    ingest(hotGames);
    ingest(weeklyGames);
    ingest(topReviewedGames);
    ingest(mostPlayedHydraGames);
    ingest(recentlyAddedGames);
    ingest(hiddenGemsGames);
    return pool;
  }, [
    hotGames,
    weeklyGames,
    topReviewedGames,
    mostPlayedHydraGames,
    recentlyAddedGames,
    hiddenGemsGames,
  ]);

  /* ── Friends Playing — image enrichment ──────────────────────
        The `/profile/friends` endpoint frequently returns
        `currentGame` entries with null image fields (the friends
        serializer is lean), so the Friends Playing row's cards came
        back grey on most users. Cross-reference each friend-game's
        objectId against the catalogue pools we already have in memory
        (hot/weekly/topReviewed/…) and the user's own library — any
        match gives us the image fields the API didn't. Falls through
        gracefully when no match is found (card stays as-is). */
  const friendsPlayingGamesEnriched = useMemo(() => {
    if (friendsPlayingGames.length === 0) return friendsPlayingGames;
    /* Build a one-shot lookup from objectId → first source with image
       data. Iteration order favours the cleanest hero/library art:
       discovery pools first (carry hero + cover + library images
       from the catalogue), library second (custom icons + library
       art the user may have explicitly set). */
    const enrichMap = new Map<
      string,
      Pick<
        HomeRowGame,
        | "libraryImageUrl"
        | "libraryHeroImageUrl"
        | "coverImageUrl"
        | "logoImageUrl"
      >
    >();
    const ingest = (games: HomeRowGame[]) => {
      for (const g of games) {
        if (enrichMap.has(g.objectId)) continue;
        enrichMap.set(g.objectId, {
          libraryImageUrl: g.libraryImageUrl,
          libraryHeroImageUrl: g.libraryHeroImageUrl,
          coverImageUrl: g.coverImageUrl,
          logoImageUrl: g.logoImageUrl,
        });
      }
    };
    ingest(universalPool);
    /* Library entries — keyed by objectId. Provides cover for any
       game the user owns even when the catalogue pools haven't
       loaded it. */
    for (const g of library) {
      if (g.isDeleted) continue;
      if (enrichMap.has(g.objectId)) continue;
      enrichMap.set(g.objectId, {
        libraryImageUrl: g.libraryImageUrl,
        libraryHeroImageUrl: g.libraryHeroImageUrl,
        coverImageUrl: g.coverImageUrl,
        logoImageUrl: g.logoImageUrl,
      });
    }
    return friendsPlayingGames.map((g) => {
      /* Only patch missing fields — never overwrite something the
         friends endpoint DID give us. */
      const needsEnrich =
        g.libraryImageUrl == null ||
        g.libraryHeroImageUrl == null ||
        g.coverImageUrl == null;
      if (!needsEnrich) return g;
      const enrich = enrichMap.get(g.objectId);
      if (!enrich) return g;
      return {
        ...g,
        libraryImageUrl: g.libraryImageUrl ?? enrich.libraryImageUrl,
        libraryHeroImageUrl:
          g.libraryHeroImageUrl ?? enrich.libraryHeroImageUrl,
        coverImageUrl: g.coverImageUrl ?? enrich.coverImageUrl,
        logoImageUrl: g.logoImageUrl ?? enrich.logoImageUrl,
      };
    });
  }, [friendsPlayingGames, universalPool, library]);

  /* ── Classics fallback pool ────────────────────────────────
        Used as the fallback for Popular Classics / PS1/PS2/PS3 /
        Browse Classics when the catalogue's launchbox search comes
        back empty (which can happen depending on env). Falls back to
        the user's own library classics last so the row never goes
        blank just because the API doesn't have classics data. */
  const libraryClassicsPool = useMemo(
    () =>
      library
        .filter((g) => !g.isDeleted && g.shop === "launchbox")
        .map(libraryGameToRowGame),
    [library]
  );

  const classicsFallbackPool = useMemo(() => {
    const pool: HomeRowGame[] = [];
    const seenIds = new Set<string>();
    const ingest = (games: HomeRowGame[]) => {
      for (const g of games) {
        const k = keyOf(g);
        if (seenIds.has(k)) continue;
        seenIds.add(k);
        pool.push(g);
      }
    };
    ingest(classicsGames);
    ingest(ps1Games);
    ingest(ps2Games);
    ingest(ps3Games);
    ingest(libraryClassicsPool);
    return pool;
  }, [classicsGames, ps1Games, ps2Games, ps3Games, libraryClassicsPool]);

  /* Cross-row launchbox pool keyed by system.
     The user reported PS2 / PS3 rows showing only library entries
     even though /catalogue/weekly returns plenty of launchbox PS2 /
     PS3 games in its mixed-shop response. The dedicated per-platform
     fetch comes back empty in staging for those platforms, so the
     ps2Games / ps3Games state stays at []. But every other row's
     state (weekly / hot / mostPlayedHydra / recentlyAdded / etc.)
     ALREADY contains those launchbox games — they're just sitting
     in their own buckets unable to surface in the PS2 / PS3 rows.

     This memo scans every catalogue-fetched row, picks out the
     launchbox-shop entries, and groups them by system. The PS2 /
     PS3 row data slices below use it as another fallback layer
     before reaching for the mock dataset, so refreshes finally
     surface real catalogue PS2 / PS3 content.

     Dedup by `keyOf(g)` so a launchbox game appearing in multiple
     fetched rows lands once. */
  const crossSourceClassicsByPlatform = useMemo(() => {
    const buckets: Record<"ps1" | "ps2" | "ps3", HomeRowGame[]> = {
      ps1: [],
      ps2: [],
      ps3: [],
    };
    const seenIds: Record<"ps1" | "ps2" | "ps3", Set<string>> = {
      ps1: new Set(),
      ps2: new Set(),
      ps3: new Set(),
    };
    const ingest = (games: HomeRowGame[]) => {
      for (const g of games) {
        if (g.shop !== "launchbox") continue;
        const system = platformToSystem(g.platform);
        if (system !== "ps1" && system !== "ps2" && system !== "ps3") continue;
        const k = keyOf(g);
        if (seenIds[system].has(k)) continue;
        seenIds[system].add(k);
        buckets[system].push(g);
      }
    };
    ingest(weeklyGames);
    ingest(hotGames);
    ingest(topReviewedGames);
    ingest(mostPlayedHydraGames);
    ingest(recentlyAddedGames);
    ingest(hiddenGemsGames);
    ingest(criticallyAcclaimedGames);
    ingest(brandNewGames);
    return buckets;
  }, [
    weeklyGames,
    hotGames,
    topReviewedGames,
    mostPlayedHydraGames,
    recentlyAddedGames,
    hiddenGemsGames,
    criticallyAcclaimedGames,
    brandNewGames,
  ]);

  /* ── Personal-signal flag — drives discovery-only mode ─────── */
  const hasPersonalSignal = useMemo(
    () => library.some((g) => !g.isDeleted),
    [library]
  );

  /* ── Library set for discovery exclusion ───────────────────── */
  const librarySet = useMemo(
    () => new Set(library.filter((g) => !g.isDeleted).map((g) => keyOf(g))),
    [library]
  );

  /* ── Per-game genre lookup ──────────────────────────────────
        Library entries don't carry catalogue `genres` tags
        directly, so cross-reference every catalogue-fetched game we
        have in memory and build a Map<objectId → genres[]>. This is
        the source of truth for "which of the user's library games
        belong to genre X?" — used by `seedGameForGenre` below to
        personalize genre row titles with a played game's icon +
        name. */
  const libraryGameGenres = useMemo(() => {
    const map = new Map<string, string[]>();
    const ingest = (games: HomeRowGame[]) => {
      for (const g of games) {
        if (g.genres && g.genres.length > 0) {
          map.set(g.objectId, g.genres);
        }
      }
    };
    ingest(hotGames);
    ingest(weeklyGames);
    ingest(topReviewedGames);
    ingest(mostPlayedHydraGames);
    ingest(recentlyAddedGames);
    ingest(hiddenGemsGames);
    ingest(criticallyAcclaimedGames);
    ingest(brandNewGames);
    Object.values(genreData).forEach(ingest);
    Object.values(tagData).forEach(ingest);
    return map;
  }, [
    hotGames,
    weeklyGames,
    topReviewedGames,
    mostPlayedHydraGames,
    recentlyAddedGames,
    hiddenGemsGames,
    criticallyAcclaimedGames,
    brandNewGames,
    genreData,
    tagData,
  ]);

  /* Greedy assignment of library games → genre rows, computed once.
     Walks the user's library in play-time-descending order and
     assigns each game to the FIRST matching unclaimed genre row in
     PERSONALIZED_GENRE_ORDER. Result: each library game seeds AT
     MOST ONE row, and each row is seeded by the most-played
     unassigned game matching it. Stops the previous bug where one
     popular library title was repeated as the seed across many
     rows (e.g. an RPG/Action/Adventure title appearing as "Because
     you played X" three times). */
  const seedAssignments = useMemo(() => {
    const claimedGenres = new Set<string>();
    const claimedGames = new Set<string>();
    const map = new Map<string, LibraryGame>();
    const orderedLibrary = library
      .filter((g) => !g.isDeleted && (g.playTimeInMilliseconds ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
      );
    for (const game of orderedLibrary) {
      if (claimedGames.has(game.objectId)) continue;
      const gameGenres = libraryGameGenres.get(game.objectId);
      if (!gameGenres) continue;
      const lowerSet = new Set(gameGenres.map((g) => g.toLowerCase()));
      for (const genre of PERSONALIZED_GENRE_ORDER) {
        if (claimedGenres.has(genre)) continue;
        if (lowerSet.has(genre.toLowerCase())) {
          map.set(genre, game);
          claimedGenres.add(genre);
          claimedGames.add(game.objectId);
          break;
        }
      }
    }
    return map;
  }, [library, libraryGameGenres]);

  /* ── "Because you played X" seed (Hero slide) ────────────────
        Pick a random game out of the user's last 15 most-recently-
        played titles (PC OR classics), deterministic per
        `sessionSeed` so the same refresh always lands on the same
        seed. The 15-game window is large enough to feel fresh
        across refreshes without ever surfacing a game the user
        hasn't touched in months. Classics are allowed — their
        similar-games come from the classics catalogue (matched by
        platform + optional genre, see `classicsSimilarBySeed`
        below) rather than the SteamSpy-tags pipeline. */
  /* Each refresh surfaces up to N distinct "Because you played X" rows
     and up to M distinct "Because you love X" rows. The seeds are
     drawn via a Fisher-Yates shuffle of the candidate pool keyed by
     `sessionSeed` so the picks are deterministic per refresh but
     change on every fresh-launch ≥30-min re-roll. Drawing multiple
     seeds (instead of one) is what the user asked for: a minimum of 2
     of each row whenever the library supports it, scaling down only
     when the pool is genuinely small (fewer than the target). */
  /* Target row count per refresh for each personalised family. Both
     scale down gracefully when the user's library is small (fewer than
     the target distinct seeds available). User explicitly asked for 2
     of each. */
  const BECAUSE_YOU_PLAYED_ROW_COUNT = 2;
  const BECAUSE_YOU_LOVE_ROW_COUNT = 2;

  const becauseYouPlayedSeeds = useMemo<LibraryGame[]>(() => {
    const recent = library
      .filter((g) => !g.isDeleted && g.lastTimePlayed != null)
      .sort(
        (a, b) =>
          new Date(b.lastTimePlayed as string | Date).getTime() -
          new Date(a.lastTimePlayed as string | Date).getTime()
      )
      .slice(0, 15);
    if (recent.length === 0) return [];
    /* Deterministic Fisher-Yates shuffle keyed by sessionSeed^0xc1
       (same key the previous single-seed picker used so the first
       pick stays stable for users who only have a tiny library). */
    let state = (sessionSeed ^ 0xc1) >>> 0 || 1;
    const rng = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = recent.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.slice(0, BECAUSE_YOU_PLAYED_ROW_COUNT);
  }, [library, sessionSeed]);

  /* ── "Because you love X" seeds (multiple dedicated Home rows) ──
        Random picks from the user's top 10 most-played titles by
        playtime. Same Fisher-Yates strategy as the played seeds —
        deterministic per refresh, multiple distinct picks per home. */
  const becauseYouLoveSeeds = useMemo<LibraryGame[]>(() => {
    const topPlayed = library
      .filter((g) => !g.isDeleted && (g.playTimeInMilliseconds ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
      )
      .slice(0, 10);
    if (topPlayed.length === 0) return [];
    let state = (sessionSeed ^ 0xd1) >>> 0 || 1;
    const rng = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = topPlayed.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    /* Avoid double-picking the same game across "played" and "love"
       rows — if a game lands in both, drop it from the love list so
       the two row families read as distinct surfaces. The shuffle
       above already keeps the love picks deterministic; the dedup
       just trims overlap. */
    const playedIds = new Set(becauseYouPlayedSeeds.map((g) => g.objectId));
    const filtered = out.filter((g) => !playedIds.has(g.objectId));
    return filtered.slice(0, BECAUSE_YOU_LOVE_ROW_COUNT);
  }, [library, sessionSeed, becauseYouPlayedSeeds]);

  /* Single-seed accessor for the Hero "because-you-played" slide —
     it surfaces one chip per refresh, so we feed it the first pick
     from the deterministic shuffle. The Hero never used the love
     seed (it only has a because-you-played kind), so no love
     accessor is needed here. */
  const becauseYouPlayedSeed = becauseYouPlayedSeeds[0] ?? null;

  /* Union of all seed games whose similar-games results we need to
     hydrate / fetch this session. Combines the per-genre row seeds
     (seedAssignments) with the two random picks above, dedup'd by
     objectId so we don't double-fetch when a seed game happens to
     appear in multiple sources. The hydrate + fetch effects below
     iterate this map instead of seedAssignments directly. */
  const similarSeedGames = useMemo<Map<string, LibraryGame>>(() => {
    const map = new Map<string, LibraryGame>();
    for (const seed of seedAssignments.values()) {
      map.set(seed.objectId, seed);
    }
    /* All multi-seed picks (3 played + 3 love) are registered so
       every "Because you played/love X" row gets its own
       similar-games fetch — without this, only the [0] seed of each
       array would surface real data and the other rows would
       silently fall back to the hot-games pool. */
    for (const seed of becauseYouPlayedSeeds) {
      map.set(seed.objectId, seed);
    }
    for (const seed of becauseYouLoveSeeds) {
      map.set(seed.objectId, seed);
    }
    return map;
  }, [seedAssignments, becauseYouPlayedSeeds, becauseYouLoveSeeds]);

  /* ── Similar-games fetch keyed by seed game ──────────────────
        For each seed in seedAssignments we fetch a catalogue search
        keyed by THAT game's top 2 catalogue genres (e.g. Cyberpunk =
        ["Action","RPG"] → fetch {genres:["Action","RPG"]} which the
        catalogue API ANDs, returning only games matching BOTH). This
        is the actual data shown in the personalised row, not just a
        re-sorted genre pool. Each result is cached in levelDB under
        `similar:<objectId>` so subsequent mounts paint instantly.
        Skips fetches for seeds whose catalogue-derived genre array
        has < 2 entries (no signal). */
  const [similarGamesBySeed, setSimilarGamesBySeed] = useState<
    Map<string, HomeRowGame[]>
  >(new Map());

  /* Hydrate similar-games cache for every current seed on mount /
     refetch / library change. Misses are handled by the fetch effect
     below; cache hits paint instantly. */
  useEffect(() => {
    if (similarSeedGames.size === 0) return;
    let cancelled = false;
    /* Use the union seed map so the cache hydrate also covers the
       random "Because you played" / "Because you love" seeds, not
       just the per-genre row seeds. */
    const ids = Array.from(similarSeedGames.values()).map((s) => s.objectId);
    Promise.all(
      ids.map(async (id) => {
        const cached = await readHomeCache(`similar:${id}` as HomeCacheKey);
        return [id, cached] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setSimilarGamesBySeed((prev) => {
        const next = new Map(prev);
        for (const [id, games] of entries) {
          if (games && games.length > 0 && !next.has(id)) {
            next.set(id, games);
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [similarSeedGames]);

  useEffect(() => {
    /* Fire as soon as the inputs are ready instead of waiting for
       visibleTier >= 2. The Hero renders at tier 0 and needs the
       similar-games pool populated before its first cache write —
       gating on tier 2 meant the Hero locked an empty libraryRelated
       composition into the 24h cache before the user ever scrolled
       far enough to load the similar pool. */
    if (!sourcesLoaded) return;
    if (similarSeedGames.size === 0) return;
    /* The Steam User Tags map must be present for SteamSpy tag NAMES
       → numeric IDs resolution. Without it we can't filter by tags
       (only by genres), which is a much weaker similarity signal. So
       wait until the map is loaded before kicking off the
       SteamSpy-driven fetches — the catalogue search payload itself
       requires numeric tag IDs. */
    const tagMap = steamUserTags["en"];
    if (!tagMap || Object.keys(tagMap).length === 0) return;

    let cancelled = false;

    /* Per-seed strategy:
         • Steam seeds: fetch SteamSpy top user tags, resolve top-N
           that map to IDs in `tagMap`, take the first 2, do a
           catalogue search with `{tags:[id1,id2]}`. The catalogue
           ANDs the tags filter so the result IS games matching
           BOTH of the seed's top tags. Falls back to genres if the
           SteamSpy fetch fails or fewer than 2 tags resolve.
         • Non-steam seeds (shouldn't normally happen since launchbox
           library games rarely have catalogue genres assigned, but
           guard anyway): use the catalogue `genres` for the seed
           game and AND-filter on those. */
    Promise.all(
      Array.from(similarSeedGames.values()).map(async (seed) => {
        let rows: HomeRowGame[] = [];

        if (seed.shop === "steam") {
          const tagNames = await fetchSteamSpyTopTags(seed.objectId);
          const tagIds: number[] = [];
          for (const name of tagNames) {
            const id = tagMap[name];
            if (typeof id === "number") {
              tagIds.push(id);
              if (tagIds.length === 2) break;
            }
          }
          if (tagIds.length >= 2) {
            const games = await postSearch<CatalogueSearchResult>(
              buildSearch({ tags: tagIds }, sourceIds)
            );
            rows = games.map(catalogueToRowGame);
          }
        }

        /* Genre fallback — only fires if the SteamSpy path above
           produced nothing usable (no tags, < 2 resolved IDs, fetch
           failed, OR the seed isn't a Steam game). Uses the same
           AND-filter mechanic but on the broader genre signal. */
        if (rows.length === 0) {
          const gs = libraryGameGenres.get(seed.objectId);
          if (gs && gs.length >= 2) {
            const games = await postSearch<CatalogueSearchResult>(
              buildSearch({ genres: gs.slice(0, 2) }, sourceIds)
            );
            rows = games.map(catalogueToRowGame);
          }
        }

        if (rows.length > 0) {
          writeHomeCache(`similar:${seed.objectId}` as HomeCacheKey, rows);
        }
        return [seed.objectId, rows] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setSimilarGamesBySeed((prev) => {
        const next = new Map(prev);
        for (const [id, rows] of entries) {
          if (rows.length > 0) next.set(id, rows);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    similarSeedGames,
    libraryGameGenres,
    sourcesLoaded,
    sourceIds,
    refetchToken,
    postSearch,
    steamUserTags,
  ]);

  /* Map<genre, HomeRowGame[]> — only contains entries for personalised
     rows whose similar-games fetch returned non-empty. Used by both
     the row data and the title to decide whether personalisation
     fires for that row. A seed with empty similar results means we
     show the regular genre data + plain genre title for that row. */
  const personalizedRowGames = useMemo(() => {
    const map = new Map<string, HomeRowGame[]>();
    for (const [genre, seed] of seedAssignments) {
      const games = similarGamesBySeed.get(seed.objectId);
      if (games && games.length > 0) {
        map.set(genre, games);
      }
    }
    return map;
  }, [seedAssignments, similarGamesBySeed]);

  /* When a row has a personalised seed AND its similar-games fetch
     returned content, REPLACE the row's candidate pool with that
     similar-games result. Returns the genre's normal pool otherwise
     so the row still renders with generic content while the similar
     fetch is in flight or empty. */
  const personalizeRowPool = useCallback(
    (genre: string, baseGames: HomeRowGame[]): HomeRowGame[] => {
      const similar = personalizedRowGames.get(genre);
      return similar && similar.length > 0 ? similar : baseGames;
    },
    [personalizedRowGames]
  );

  /* ── Classics similar-games (synchronous, no API call) ──────
        The modern catalogue's /search ANDs tags/genres but never
        returns launchbox-shop games (classics). To surface classics
        alongside the PC similar-games, derive them client-side from
        the classics pools we already have on Home.
        Match strategy:
          • Classic seed → return classics on the SAME platform as the
            seed (PS1, PS2, PS3). If the seed has known catalogue
            genres, additionally filter by genre overlap. Platform is
            the strongest similarity signal for classics ("more PS2
            games like the one you played").
          • PC seed → return classics whose genres overlap the seed's
            catalogue genres (the same first-2-genres signal the
            modern fetch uses). Skips when the seed has no genre data.
        Returns Map<seedObjectId, HomeRowGame[]> matching the shape
        of `similarGamesBySeed`. The seed itself is excluded so it
        never appears in its own row. */
  const classicsSimilarBySeed = useMemo(() => {
    const out = new Map<string, HomeRowGame[]>();
    if (similarSeedGames.size === 0) return out;
    if (classicsFallbackPool.length === 0) return out;

    for (const seed of similarSeedGames.values()) {
      const seedSystem =
        seed.shop === "launchbox" ? platformToSystem(seed.platform) : null;
      const seedGenres = libraryGameGenres.get(seed.objectId) ?? [];
      const seedGenresLower = seedGenres.map((g) => g.toLowerCase());

      const matches: HomeRowGame[] = [];
      const seen = new Set<string>();
      for (const g of classicsFallbackPool) {
        if (g.shop !== "launchbox") continue;
        if (g.objectId === seed.objectId) continue;
        const k = `${g.shop}:${g.objectId}`;
        if (seen.has(k)) continue;

        if (seed.shop === "launchbox") {
          /* Classic seed — require same platform. Optional genre
             overlap when the seed has genre data; otherwise platform
             alone is sufficient. */
          if (!seedSystem) continue;
          if (platformToSystem(g.platform) !== seedSystem) continue;
          if (seedGenresLower.length > 0) {
            const gs = g.genres ?? [];
            const overlap = gs.some((x) =>
              seedGenresLower.includes(x.toLowerCase())
            );
            /* When genre data is present on BOTH sides, require an
               overlap. When the candidate classic has no `genres`
               field at all (common — staging often returns launchbox
               games without genres), keep it: platform alone already
               makes it a fair match. */
            if (!overlap && gs.length > 0) continue;
          }
        } else {
          /* PC seed — require genre overlap. Without seed genre
             data we can't reasonably match a classic, so skip. */
          if (seedGenresLower.length === 0) break;
          const gs = g.genres ?? [];
          if (gs.length === 0) continue;
          const overlap = gs.some((x) =>
            seedGenresLower.includes(x.toLowerCase())
          );
          if (!overlap) continue;
        }

        seen.add(k);
        matches.push(g);
        /* Cap per seed — keeps the merged list short enough that
           classics don't crowd out the PC matches in the row. */
        if (matches.length >= 16) break;
      }

      if (matches.length > 0) {
        out.set(seed.objectId, matches);
      }
    }

    return out;
  }, [similarSeedGames, classicsFallbackPool, libraryGameGenres]);

  /* Union of PC similar (from the async /search fetch) + classics
     similar (synchronous client-side filter). The "Because you
     played" Hero slide and the "Because you love" row read from this
     map so their results can mix modern + classics where applicable. */
  const allSimilarBySeed = useMemo(() => {
    const map = new Map<string, HomeRowGame[]>();
    for (const [id, games] of similarGamesBySeed) {
      map.set(id, [...games]);
    }
    for (const [id, classics] of classicsSimilarBySeed) {
      const existing = map.get(id) ?? [];
      map.set(id, [...existing, ...classics]);
    }
    return map;
  }, [similarGamesBySeed, classicsSimilarBySeed]);

  /* ── Library-derived row arrays (full, pre-slice) ──────────── */
  /* (The Continue Playing row was removed in an earlier iteration;
     its `continuePlayingGames` derivation used to live here. Left
     out entirely now — recentlyPlayedGames below covers the same
     surface with broader filtering.) */

  const recentlyPlayedGames = useMemo(() => {
    /* No time cutoff — the row should fill up to MAX_ROW_GAMES (16)
       whenever the library has at least that many played entries.
       The 30-day window we used before suppressed users with bigger
       libraries who hadn't touched their oldest games recently,
       making the row look short even when they had 50+ played games
       to surface. Order desc by lastTimePlayed; games that never
       carried a play timestamp are filtered out so the row stays
       "things you've played" rather than "things in your library". */
    return enrichLibraryRow(
      library
        .filter((g) => !g.isDeleted && g.lastTimePlayed != null)
        .sort(
          (a, b) =>
            new Date(b.lastTimePlayed!).getTime() -
            new Date(a.lastTimePlayed!).getTime()
        )
        .slice(0, FETCH_SIZE)
        .map(libraryGameToRowGame)
    );
  }, [library, enrichLibraryRow]);

  const favoriteGames = useMemo(
    () =>
      enrichLibraryRow(
        library
          .filter((g) => !g.isDeleted && g.favorite)
          .slice(0, FETCH_SIZE)
          .map(libraryGameToRowGame)
      ),
    [library, enrichLibraryRow]
  );

  /* "Games to beat" — library games with partial achievement progress.
     Sorts by completion % DESC so the games the user is closest to
     100%-ing surface first. Excludes already-completed games (would
     be misleading to suggest "go beat this — it's done") and games
     with no achievements (no signal). Only meaningful for the
     subset of the library that surfaces achievements at all. */
  const gamesToBeatGames = useMemo(
    () =>
      enrichLibraryRow(
        library
          .filter(
            (g) =>
              !g.isDeleted &&
              (g.achievementCount ?? 0) > 0 &&
              (g.unlockedAchievementCount ?? 0) > 0 &&
              (g.unlockedAchievementCount ?? 0) < (g.achievementCount ?? 0)
          )
          .sort((a, b) => {
            const pctA =
              (a.unlockedAchievementCount ?? 0) /
              Math.max(1, a.achievementCount ?? 1);
            const pctB =
              (b.unlockedAchievementCount ?? 0) /
              Math.max(1, b.achievementCount ?? 1);
            return pctB - pctA;
          })
          .slice(0, FETCH_SIZE)
          .map(libraryGameToRowGame)
      ),
    [library, enrichLibraryRow]
  );

  const fromCollectionsGames = useMemo(
    () =>
      enrichLibraryRow(
        library
          .filter(
            (g) =>
              !g.isDeleted &&
              Array.isArray(g.collectionIds) &&
              g.collectionIds.length > 0
          )
          .slice(0, FETCH_SIZE)
          .map(libraryGameToRowGame)
      ),
    [library, enrichLibraryRow]
  );

  const fromLibraryGames = useMemo(
    () =>
      enrichLibraryRow(
        library
          .filter((g) => !g.isDeleted)
          .sort((a, b) => {
            const aD = a.addedToLibraryAt
              ? new Date(a.addedToLibraryAt).getTime()
              : 0;
            const bD = b.addedToLibraryAt
              ? new Date(b.addedToLibraryAt).getTime()
              : 0;
            return bD - aD;
          })
          .slice(0, FETCH_SIZE)
          .map(libraryGameToRowGame)
      ),
    [library, enrichLibraryRow]
  );

  /* ── Classics breakdown ─────────────────────────────────────
     Match raw classics-game `platform` names against launchbox-filter
     platforms (key/name pairs) so the "See all" navigates with the
     KEY the catalogue's platform filter actually understands. */
  const platformKeys = useMemo(() => {
    const findKey = (system: "ps1" | "ps2" | "ps3") => {
      const found = launchboxFilters.platforms.find(
        (p) => platformToSystem(p.name) === system
      );
      return found?.key ?? null;
    };
    return {
      ps1: findKey("ps1"),
      ps2: findKey("ps2"),
      ps3: findKey("ps3"),
    };
  }, [launchboxFilters]);

  /* Pool for Browse Classics: union of all classics sources (broad
     catalogue + per-platform + library), regardless of platform. The
     row is meant as a "show me anything retro" surface, so the more
     inclusive the source the better — variety is provided by the
     per-row seeded shuffle, not by curating which platform to show. */
  const browseClassicsPool = classicsFallbackPool;

  /* Classics-by-genre selector.
     Source priority:
       0. `classicsByPlatformAndGenreFetched` map — populated by the
          dedicated per-(platform, genre) /catalogue/search fetch
          above. When the fetch has resolved AND returned anything,
          we use it verbatim: the API filter is more accurate than
          our local title-keyword heuristic. This is what makes the
          PS2/PS3 genre rows actually populated under staging.
       1. `genres` array on already-fetched per-platform games —
          matches by tag (case-insensitive).
       2. Title keyword fallback — used when neither of the above
          surfaces a hit (legacy behaviour kept so existing PS1
          rows don't regress on the off-chance staging stops
          accepting the composite filter).

     Returns an empty array when no matches exist; the row hides
     naturally via HomeRow's empty-state. */
  const classicsByPlatformAndGenre = useCallback(
    (system: "ps1" | "ps2" | "ps3", genre: string): HomeRowGame[] => {
      /* Tier 0 — prefer the dedicated per-combo fetch result. */
      const fetched = classicsByPlatformAndGenreFetched.get(
        `${system}:${genre}`
      );
      if (fetched && fetched.length > 0) return fetched;
      const seenIds = new Set<string>();
      const out: HomeRowGame[] = [];
      const wantedGenre = genre.toLowerCase();
      /* Genre-to-title keyword bank — used only when `genres` isn't
         populated. Aliases give title-match a fighting chance even
         when the game's title doesn't include the genre word
         verbatim (e.g. "Silent Hill" matches "horror" via "silent"). */
      const keywords: Record<string, string[]> = {
        horror: ["horror", "silent hill", "resident evil", "fatal frame"],
        rpg: [
          "rpg",
          "final fantasy",
          "dragon quest",
          "tales of",
          "kingdom hearts",
        ],
        action: ["action", "devil may cry", "god of war", "metal gear"],
        platformer: [
          "platformer",
          "platform",
          "crash bandicoot",
          "spyro",
          "rayman",
          "klonoa",
          "jak",
          "ratchet",
        ],
        fighting: [
          "fighting",
          "tekken",
          "mortal kombat",
          "street fighter",
          "soulcalibur",
          "soul calibur",
          "virtua fighter",
          "dead or alive",
        ],
        adventure: [
          "adventure",
          "myst",
          "broken sword",
          "syphon filter",
          "tomb raider",
        ],
      };
      const titleKeywords = keywords[wantedGenre] ?? [wantedGenre];
      const consider = (g: HomeRowGame) => {
        if (platformToSystem(g.platform) !== system) return;
        const k = keyOf(g);
        if (seenIds.has(k)) return;
        const gs = g.genres;
        const matchesByGenre =
          gs && gs.some((x) => x.toLowerCase() === wantedGenre);
        const lt = g.title?.toLowerCase() ?? "";
        const matchesByTitle =
          !gs && titleKeywords.some((kw) => lt.includes(kw));
        if (!matchesByGenre && !matchesByTitle) return;
        seenIds.add(k);
        out.push(g);
      };
      for (const g of classicsGames) consider(g);
      for (const g of libraryClassicsPool) consider(g);
      /* Cross-source launchbox games pulled from weekly / hot / top-
         reviewed / etc. — same data flow that fixed the "PS2 row
         only shows library entries" complaint, applied to the
         per-genre filter so PS2 / PS3 genre rows can pick from
         catalogue results that landed in OTHER rows. */
      if (system === "ps1") {
        for (const g of crossSourceClassicsByPlatform.ps1) consider(g);
      } else if (system === "ps2") {
        for (const g of crossSourceClassicsByPlatform.ps2) consider(g);
      } else if (system === "ps3") {
        for (const g of crossSourceClassicsByPlatform.ps3) consider(g);
      }
      /* Mock fallback so the per-platform / per-genre rows can find
         PS2 + PS3 candidates even when the catalogue API returns
         none. Each mock game carries proper genre tags so the
         genre-matching path above resolves cleanly. */
      if (system === "ps2") {
        for (const g of MOCK_PS2_GAMES) consider(g);
      } else if (system === "ps3") {
        for (const g of MOCK_PS3_GAMES) consider(g);
      }
      return out;
    },
    [
      classicsGames,
      libraryClassicsPool,
      classicsByPlatformAndGenreFetched,
      crossSourceClassicsByPlatform,
    ]
  );

  /* Pool for the "Retro & Old-School" row: interleaves pre-2010 PC
     catalogue titles with launchbox classics so the row mixes both
     worlds. Interleaving (alternating PC ↔ classics) gives both
     domains presence at the top of the row even after the per-row
     seeded shuffle picks 16 from it. Falls back to whichever side
     has data if the other returned empty. */
  const retroMixedPool = useMemo(() => {
    const pc = retroPcGames;
    const classics = classicsGames;
    if (pc.length === 0) return classics;
    if (classics.length === 0) return pc;
    const interleaved: HomeRowGame[] = [];
    const maxLen = Math.max(pc.length, classics.length);
    for (let i = 0; i < maxLen; i++) {
      if (pc[i]) interleaved.push(pc[i]);
      if (classics[i]) interleaved.push(classics[i]);
    }
    return interleaved;
  }, [retroPcGames, classicsGames]);

  /* ─────────────────────────────────────────────────────────────
     DISPLAY SLICING

     `seen` is built fresh each render. Discovery rows claim into it
     in source-order; once claimed, a game can't appear in any later
     row. Personal rows bypass dedup.

     Shuffle = random pick within the deeper pool seeded by
     hashRowKey(rowKey, sessionSeed). Each session shows different
     games from the same pool.

     Pool relaxation: if filters leave fewer than POOL_RELAX_THRESHOLD
     games, library exclude is dropped for that row only.
  ──────────────────────────────────────────────────────────────── */
  /* GLOBAL dedup across every discovery row on the home page —
     replaces the previous per-tier `seenByTier` + `fallbackSeen`
     pair. A game claimed by Popular on Hydra (tier 0) is then
     barred from re-appearing in Action (tier 2), Brand New (tier
     3), Browse Classics (tier 4), etc. Personal rows still bypass
     via `dedup: false`, so the user's library / favorites can
     freely overlap with anything else.

     Seeded up-front with the games we're about to pass to the
     Hero (top of weeklyGames, classicsGames, hotGames). The Hero
     consumes its own /catalogue/featured fetch internally so a
     few of its slides slip past this seed — but the four we DO
     know about cover the visible-above-the-fold overlap that
     would otherwise be the most jarring repetition. */
  const globallySeen = new Set<string>();
  /* Pre-block more aggressively: the top 3 of each source the Hero
     can draw from. The carousel's slot composition can pull from
     featured / classics / weekly / hot / topReviewed / recentlyAdded
     so blocking the top entries of each pre-empts the most jarring
     overlap between Hero and the discovery rows below. */
  for (const g of weeklyGames.slice(0, 3)) globallySeen.add(keyOf(g));
  for (const g of classicsGames.slice(0, 3)) globallySeen.add(keyOf(g));
  for (const g of hotGames.slice(0, 3)) globallySeen.add(keyOf(g));
  for (const g of topReviewedGames.slice(0, 3)) globallySeen.add(keyOf(g));
  for (const g of recentlyAddedGames.slice(0, 3)) globallySeen.add(keyOf(g));

  type SliceOpts = {
    rowKey: string;
    /** No longer drives any bucket — kept for callsite compat. */
    tier: number;
    excludeLibrary?: boolean;
    dedup?: boolean;
    shuffle?: boolean;
    /** When true, picks are added to globallySeen even if `dedup` is
     *  false. Used by Popular on Hydra so it always shows the actual
     *  top games unfiltered, but downstream rows still skip them. */
    recordSeenAnyway?: boolean;
    /* Generic pool used when this row's own data ends up empty (e.g.
       the API returned 0 results for an obscure tag, or dedup
       consumed everything). Keeps the row from disappearing. */
    fallbackPool?: HomeRowGame[];
  };

  const sliceDiscovery = (
    games: HomeRowGame[],
    opts: SliceOpts
  ): HomeRowGame[] => {
    const {
      rowKey,
      excludeLibrary = true,
      dedup = true,
      shuffle = true,
      recordSeenAnyway = false,
      fallbackPool = [],
    } = opts;

    /* Walk a source list applying the active filters. Each flag
       flips what we ALLOW, so `allowSeen=true` means "don't filter
       on globallySeen". */
    const filter = (
      src: HomeRowGame[],
      allowLibrary: boolean,
      allowSeen: boolean
    ): HomeRowGame[] => {
      const out: HomeRowGame[] = [];
      for (const g of src) {
        const k = keyOf(g);
        if (!allowSeen && dedup && globallySeen.has(k)) continue;
        if (!allowLibrary && excludeLibrary && librarySet.has(k)) continue;
        out.push(g);
      }
      return out;
    };

    /* Pass 1: strict — own data, library excluded, dedup applied. */
    let pool = filter(games, false, false);

    /* Pass 2: drop library exclude if too thin. */
    if (pool.length < POOL_RELAX_THRESHOLD && excludeLibrary) {
      pool = filter(games, true, false);
    }

    /* Pass 3: own-games fallback — if dedup exhausted the row, fall
       back to its OWN games with unseen-first ordering. Keeps the
       row on-topic (e.g. Action only shows Action) even when some
       picks have to repeat. Preferred over Pass 4's generic pool. */
    if (pool.length === 0 && games.length > 0) {
      const unseen = games.filter(
        (g) => !excludeLibrary || !librarySet.has(keyOf(g))
      );
      pool = [
        ...unseen.filter((g) => !globallySeen.has(keyOf(g))),
        ...unseen.filter((g) => globallySeen.has(keyOf(g))),
      ];
    }

    /* Pass 4: last-resort generic fallback — only when the row's own
       fetch returned nothing at all (empty staging response,
       missing genre mapping, etc.). Prevents the row from vanishing
       in degraded environments. The same globallySeen set is
       consulted here so a hot game claimed by an earlier tier's
       Pass 4 doesn't reappear. */
    if (pool.length === 0 && fallbackPool.length > 0) {
      const usable = fallbackPool.filter((g) => {
        const k = keyOf(g);
        if (dedup && globallySeen.has(k)) return false;
        if (excludeLibrary && librarySet.has(k)) return false;
        return true;
      });
      pool = usable;
      /* Cushion: relax globallySeen if even the fallback came up
         empty (rank unseen-first, then seen). */
      if (pool.length === 0) {
        const unseen = fallbackPool.filter(
          (g) => !excludeLibrary || !librarySet.has(keyOf(g))
        );
        pool = [
          ...unseen.filter((g) => !globallySeen.has(keyOf(g))),
          ...unseen.filter((g) => globallySeen.has(keyOf(g))),
        ];
      }
    }

    /* Pick games: shuffled + series-diverse for the typical case, or
       sequential for rows where ordering matters (Popular on Hydra
       always shows the actual top). pickNDiverse caps each title-
       series at 1 entry per row so e.g. an RPG row doesn't fill up
       with three Persona / Yakuza / Final Fantasy entries — the
       most common form of "this row looks generic" feedback. */
    const picked = shuffle
      ? pickNDiverse(pool, MAX_ROW_GAMES, hashRowKey(rowKey, sessionSeed))
      : pool.slice(0, MAX_ROW_GAMES);

    /* Commit picks to globallySeen so every later row across every
       tier skips them. `recordSeenAnyway` lets rows that bypass the
       READ side (Popular on Hydra) still participate in the WRITE
       side — i.e. show their unfiltered top but block those games
       from appearing again downstream. */
    if (dedup || recordSeenAnyway) {
      for (const g of picked) globallySeen.add(keyOf(g));
    }

    /* Backfill source badges from the cross-row cache. */
    return enrichSources(picked);
  };

  /** Personal rows: no dedup, no library exclude — just slice + enrich. */
  const personal = (games: HomeRowGame[]) =>
    enrichSources(games.slice(0, MAX_ROW_GAMES));

  /* ── Random Picks pool ────────────────────────────────────
        A wide, diverse union used by the "Random Picks" row.
        Mixes every catalogue-fetched discovery source (universalPool
        already covers Hot / Weekly / Top Reviewed / Most Played /
        Recently Added / Hidden Gems) with classics + the genre /
        tag rows so the user genuinely sees variety, not just a
        re-shuffle of the same hot games. Deduped by `keyOf`. */
  const randomPicksPool = (() => {
    const pool: HomeRowGame[] = [];
    const ids = new Set<string>();
    const ingest = (list: HomeRowGame[]) => {
      for (const g of list) {
        const k = keyOf(g);
        if (ids.has(k)) continue;
        ids.add(k);
        pool.push(g);
      }
    };
    ingest(universalPool);
    ingest(classicsGames);
    ingest(criticallyAcclaimedGames);
    ingest(brandNewGames);
    for (const arr of Object.values(genreData)) ingest(arr);
    for (const arr of Object.values(tagData)) ingest(arr);
    return pool;
  })();

  /* 12 picks driven by surpriseSeed. Each Reshuffle click bumps
     the seed so pickN returns a different subset of the pool. We
     re-enrich sources after picking so badges still resolve. */
  const randomPicks = enrichSources(pickN(randomPicksPool, 12, surpriseSeed));

  const d = {
    /* ── TIER 0 — Primary discovery (dedup'd within tier 0 only) ── */
    /* Popular on Hydra — never disappears: no dedup penalty, no library
       exclude, no shuffle (always shows the actual top trending). */
    hot: sliceDiscovery(hotGames, {
      rowKey: "hot",
      tier: 0,
      dedup: false,
      excludeLibrary: false,
      shuffle: false,
      /* Bypass the READ side of dedup (we want the actual top 16
         hot games, not whatever's left after Hero pre-seeding), but
         WRITE so the next 16 popular games can't reappear in
         Most Played / Most Downloaded / Top Reviewed / genre rows
         below. The single biggest contributor to "this all looks
         generic" feedback was the same hot games showing on every
         row that fell back to popularity-sorted content. */
      recordSeenAnyway: true,
    }),
    /* Most Played on Hydra Now — distinct from hot (player-count signal).
       Ranked row: slot 1 must be the #1 most-played game right now, slot
       2 the #2, etc. `shuffle: false` skips pickNDiverse so the API's
       player-count ordering is preserved. dedup stays on so games claimed
       by Hot above aren't repeated here, but the resulting subset is
       still kept in rank order. */
    mostPlayedHydra: sliceDiscovery(mostPlayedHydraGames, {
      rowKey: "mostPlayedHydra",
      tier: 0,
      shuffle: false,
    }),
    /* Most Downloaded This Week — ranked by weekly downloads. Same
       reasoning as mostPlayedHydra: preserve the API's ranking so slot
       1 is the actual #1 most-downloaded game of the week. */
    weekly: sliceDiscovery(weeklyGames, {
      rowKey: "weekly",
      tier: 0,
      shuffle: false,
    }),
    topReviewed: sliceDiscovery(topReviewedGames, {
      rowKey: "topReviewed",
      tier: 0,
    }),
    recentlyAdded: sliceDiscovery(recentlyAddedGames, {
      rowKey: "recentlyAdded",
      tier: 0,
    }),
    hiddenGems: sliceDiscovery(hiddenGemsGames, {
      rowKey: "hiddenGems",
      tier: 0,
    }),

    /* ── TIER 1 — Personal (no dedup) ── */
    /* Continue Playing was removed (redundant with Recently Played);
       the Hero still reads continuePlayingGames internally for slides. */
    friendsPlaying: personal(friendsPlayingGamesEnriched),
    recentlyPlayed: personal(recentlyPlayedGames),
    favorites: personal(favoriteGames),
    gamesToBeat: personal(gamesToBeatGames),
    /* "Because you played X" — one row per seed in
       `becauseYouPlayedSeeds` (up to 3 random picks from the user's
       last 15 recently-played, dedup'd via the seed-array build above).
       Each row's data is the merged similar-games pool for its own
       seed (PC matches via SteamSpy-tag fetch + classics matches via
       client-side platform/genre filter), with hot games as a last-
       resort fallback so the row renders even when the seed's similar
       fetch returned empty (obscure / classic seeds). Keyed by
       objectId so React can stably remount when the seed array
       changes on refresh. */
    playedGamesBySeed: new Map(
      becauseYouPlayedSeeds.map((seed) => [
        seed.objectId,
        sliceDiscovery(allSimilarBySeed.get(seed.objectId) ?? [], {
          rowKey: `playedGames:${seed.objectId}`,
          tier: 1,
          excludeLibrary: true,
          dedup: false,
          fallbackPool: hotGames,
        }),
      ])
    ),
    /* "Because you love X" — one row per seed in `becauseYouLoveSeeds`
       (up to 3 random picks from the user's top 10 by playtime, with
       any seeds that also appear in the played list filtered out).
       Same merged-similar-games pool + hot fallback as playedGames. */
    loveGamesBySeed: new Map(
      becauseYouLoveSeeds.map((seed) => [
        seed.objectId,
        sliceDiscovery(allSimilarBySeed.get(seed.objectId) ?? [], {
          rowKey: `loveGames:${seed.objectId}`,
          tier: 1,
          excludeLibrary: true,
          dedup: false,
          fallbackPool: hotGames,
        }),
      ])
    ),
    collections: personal(fromCollectionsGames),
    library: personal(fromLibraryGames),

    /* ── TIER 2 — Genres + early tags (dedup'd within tier 2 only) ── */
    action: sliceDiscovery(
      personalizeRowPool("Action", genreData["Action"] ?? []),
      {
        rowKey: "g:Action",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    rpg: sliceDiscovery(personalizeRowPool("RPG", genreData["RPG"] ?? []), {
      rowKey: "g:RPG",
      tier: 2,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    adventure: sliceDiscovery(
      personalizeRowPool("Adventure", genreData["Adventure"] ?? []),
      {
        rowKey: "g:Adventure",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    openWorld: sliceDiscovery(tagData["openWorld"] ?? [], {
      rowKey: "t:openWorld",
      tier: 2,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    storyRich: sliceDiscovery(tagData["storyRich"] ?? [], {
      rowKey: "t:storyRich",
      tier: 2,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    strategy: sliceDiscovery(
      personalizeRowPool("Strategy", genreData["Strategy"] ?? []),
      {
        rowKey: "g:Strategy",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    simulation: sliceDiscovery(
      personalizeRowPool("Simulation", genreData["Simulation"] ?? []),
      {
        rowKey: "g:Simulation",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    indie: sliceDiscovery(
      personalizeRowPool("Indie", genreData["Indie"] ?? []),
      {
        rowKey: "g:Indie",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    sports: sliceDiscovery(
      personalizeRowPool("Sports", genreData["Sports"] ?? []),
      {
        rowKey: "g:Sports",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    racing: sliceDiscovery(
      personalizeRowPool("Racing", genreData["Racing"] ?? []),
      {
        rowKey: "g:Racing",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    puzzle: sliceDiscovery(
      personalizeRowPool("Puzzle", genreData["Puzzle"] ?? []),
      {
        rowKey: "g:Puzzle",
        tier: 2,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),

    /* ── TIER 3 — More genres/tags + classics (dedup'd within tier 3) ── */
    casual: sliceDiscovery(
      personalizeRowPool("Casual", genreData["Casual"] ?? []),
      {
        rowKey: "g:Casual",
        tier: 3,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    mm: sliceDiscovery(
      personalizeRowPool(
        "Massively Multiplayer",
        genreData["Massively Multiplayer"] ?? []
      ),
      {
        rowKey: "g:MM",
        tier: 3,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    coOp: sliceDiscovery(tagData["coOp"] ?? [], {
      rowKey: "t:coOp",
      tier: 3,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    horror: sliceDiscovery(
      personalizeRowPool("Horror", genreData["Horror"] ?? []),
      {
        rowKey: "g:Horror",
        tier: 3,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    soulsLike: sliceDiscovery(tagData["soulsLike"] ?? [], {
      rowKey: "t:soulsLike",
      tier: 3,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    fighting: sliceDiscovery(
      personalizeRowPool("Fighting", genreData["Fighting"] ?? []),
      {
        rowKey: "g:Fighting",
        tier: 3,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    platformers: sliceDiscovery(
      personalizeRowPool("Platformer", genreData["Platformer"] ?? []),
      {
        rowKey: "g:Platformer",
        tier: 3,
        /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
        fallbackPool: universalPool,
      }
    ),
    roguelite: sliceDiscovery(tagData["roguelite"] ?? [], {
      rowKey: "t:roguelite",
      tier: 3,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    /* Classics rows — each row's dedup tier MUST match where it
       actually renders in the JSX so the tier-scoped seen-set keeps
       PS1/PS2/PS3 + Browse from showing the same games as each other. */
    /* PS1/PS2/PS3 — platform-STRICT fallback chain. Each row only
       shows content actually tagged for its platform. If no on-
       platform data exists anywhere (dedicated fetch result + any
       PS-tagged entries in classicsGames + library) the row returns
       an empty array and HomeRow hides it. This is intentional:
       showing PS1 content in a PS2 row is more misleading than
       just omitting the row until real PS2 data is available. */
    ps1: enrichSources(
      (() => {
        if (ps1Games.length > 0) return ps1Games;
        const libPs1 = libraryClassicsPool.filter(
          (g) => platformToSystem(g.platform) === "ps1"
        );
        if (libPs1.length > 0) return libPs1;
        const fromBroad = classicsGames.filter(
          (g) => platformToSystem(g.platform) === "ps1"
        );
        if (fromBroad.length > 0) return fromBroad;
        /* Cross-source pool — every other catalogue row's launchbox
           entries grouped by system. The dedicated per-platform
           fetch comes back empty in some staging environments even
           though `/catalogue/weekly` clearly returns PS1 launchbox
           games; this layer pulls them out so the row populates. */
        return crossSourceClassicsByPlatform.ps1;
      })().slice(0, MAX_ROW_GAMES)
    ),
    ps2: enrichSources(
      (() => {
        if (ps2Games.length > 0) return ps2Games;
        const libPs2 = libraryClassicsPool.filter(
          (g) => platformToSystem(g.platform) === "ps2"
        );
        if (libPs2.length > 0) return libPs2;
        const fromBroad = classicsGames.filter(
          (g) => platformToSystem(g.platform) === "ps2"
        );
        if (fromBroad.length > 0) return fromBroad;
        /* Cross-source pool first — weekly / hot / top-reviewed all
           return shop=launchbox PS2 games in staging even when the
           dedicated per-platform fetch comes back empty. The user
           reported their PS2 row showed only library entries while
           the weekly row had plenty of PS2 catalogue titles; this
           closes that gap. */
        const cross = crossSourceClassicsByPlatform.ps2;
        if (cross.length > 0) return cross;
        /* Staging API doesn't return PS2 catalogue games — mock
           dataset kicks in so the row designs (and any per-genre
           PS2 variant rows below) can still be reviewed. */
        return MOCK_PS2_GAMES;
      })().slice(0, MAX_ROW_GAMES)
    ),
    ps3: enrichSources(
      (() => {
        if (ps3Games.length > 0) return ps3Games;
        const libPs3 = libraryClassicsPool.filter(
          (g) => platformToSystem(g.platform) === "ps3"
        );
        if (libPs3.length > 0) return libPs3;
        const fromBroad = classicsGames.filter(
          (g) => platformToSystem(g.platform) === "ps3"
        );
        if (fromBroad.length > 0) return fromBroad;
        const cross = crossSourceClassicsByPlatform.ps3;
        if (cross.length > 0) return cross;
        return MOCK_PS3_GAMES;
      })().slice(0, MAX_ROW_GAMES)
    ),
    /* Browse Classics — broad union of every classics source (any
       platform) shuffled per session. Dedup within tier 4 so it
       doesn't repeat the PS2/PS3 picks rendered above it. */
    browseClassics: sliceDiscovery(browseClassicsPool, {
      rowKey: "browseClassics",
      tier: 4,
      fallbackPool: classicsFallbackPool,
    }),
    /* Retro & Old-School — interleaved pre-2010 PC titles + every
       launchbox classic. Lives in tier 3 (between the PS1 row and
       the tier-4 platform/tag block) so its dedup bucket isn't
       fighting Browse Classics or PS2/PS3 for the same pool. */
    retro: sliceDiscovery(retroMixedPool, {
      rowKey: "retro",
      tier: 3,
      /* No universalPool fallback — if the merged retro pool is
         empty (both pre-2010 PC fetch AND classics fetch returned
         0), better to hide the row than fill it with modern hot
         games that defeat the row's whole concept. */
    }),

    /* Diversification rows — none of these are genre or tag filters,
       so they break up the long themed-row block with different
       signal types (quality, recency, platform). Each lives in a
       different tier so their dedup buckets are isolated. */
    criticallyAcclaimed: sliceDiscovery(criticallyAcclaimedGames, {
      rowKey: "criticallyAcclaimed",
      tier: 2,
      fallbackPool: universalPool,
    }),
    brandNew: sliceDiscovery(brandNewGames, {
      rowKey: "brandNew",
      tier: 3,
      fallbackPool: universalPool,
    }),
    /* Classics-by-platform-and-genre rows — client-side filters on
       classicsGames (no extra fetch needed). HomeRow hides each one
       automatically if its filter yields 0 matches, so on a sparse
       catalogue these can disappear without harming the layout. */
    ps2Horror: sliceDiscovery(classicsByPlatformAndGenre("ps2", "Horror"), {
      rowKey: "classics:ps2:horror",
      tier: 4,
    }),
    ps1Rpg: sliceDiscovery(classicsByPlatformAndGenre("ps1", "RPG"), {
      rowKey: "classics:ps1:rpg",
      tier: 3,
    }),
    ps1Action: sliceDiscovery(classicsByPlatformAndGenre("ps1", "Action"), {
      rowKey: "classics:ps1:action",
      tier: 4,
    }),
    ps1Platformer: sliceDiscovery(
      classicsByPlatformAndGenre("ps1", "Platformer"),
      { rowKey: "classics:ps1:platformer", tier: 4 }
    ),
    ps1Fighting: sliceDiscovery(classicsByPlatformAndGenre("ps1", "Fighting"), {
      rowKey: "classics:ps1:fighting",
      tier: 4,
    }),
    ps1Adventure: sliceDiscovery(
      classicsByPlatformAndGenre("ps1", "Adventure"),
      { rowKey: "classics:ps1:adventure", tier: 4 }
    ),
    ps2Action: sliceDiscovery(classicsByPlatformAndGenre("ps2", "Action"), {
      rowKey: "classics:ps2:action",
      tier: 4,
    }),
    /* NEW classics rows unlocked by the PS2 / PS3 mock data. Each
       is a platform × genre slice that demonstrates a row variant
       we couldn't populate before. HomeRow auto-hides any with 0
       matches so they fail gracefully if mocks are ever swapped
       out for real data of a different shape. */
    ps3Action: sliceDiscovery(classicsByPlatformAndGenre("ps3", "Action"), {
      rowKey: "classics:ps3:action",
      tier: 4,
    }),
    ps3Rpg: sliceDiscovery(classicsByPlatformAndGenre("ps3", "RPG"), {
      rowKey: "classics:ps3:rpg",
      tier: 4,
    }),
    ps3Adventure: sliceDiscovery(
      classicsByPlatformAndGenre("ps3", "Adventure"),
      { rowKey: "classics:ps3:adventure", tier: 4 }
    ),
    ps2Rpg: sliceDiscovery(classicsByPlatformAndGenre("ps2", "RPG"), {
      rowKey: "classics:ps2:rpg",
      tier: 4,
    }),
    /* Extra PS2 + PS3 genre rows unlocked by the per-(platform,
       genre) /catalogue/search fetch. Each one widens the pool of
       refreshable classics rows that the category-minimums logic
       can draw from; rows that return empty still hide via HomeRow
       auto-skip. */
    ps2Adventure: sliceDiscovery(
      classicsByPlatformAndGenre("ps2", "Adventure"),
      { rowKey: "classics:ps2:adventure", tier: 4 }
    ),
    ps2Platformer: sliceDiscovery(
      classicsByPlatformAndGenre("ps2", "Platformer"),
      { rowKey: "classics:ps2:platformer", tier: 4 }
    ),
    ps2Fighting: sliceDiscovery(classicsByPlatformAndGenre("ps2", "Fighting"), {
      rowKey: "classics:ps2:fighting",
      tier: 4,
    }),
    ps2Racing: sliceDiscovery(classicsByPlatformAndGenre("ps2", "Racing"), {
      rowKey: "classics:ps2:racing",
      tier: 4,
    }),
    ps3Horror: sliceDiscovery(classicsByPlatformAndGenre("ps3", "Horror"), {
      rowKey: "classics:ps3:horror",
      tier: 4,
    }),
    ps3Platformer: sliceDiscovery(
      classicsByPlatformAndGenre("ps3", "Platformer"),
      { rowKey: "classics:ps3:platformer", tier: 4 }
    ),
    ps3Fighting: sliceDiscovery(classicsByPlatformAndGenre("ps3", "Fighting"), {
      rowKey: "classics:ps3:fighting",
      tier: 4,
    }),
    ps3Racing: sliceDiscovery(classicsByPlatformAndGenre("ps3", "Racing"), {
      rowKey: "classics:ps3:racing",
      tier: 4,
    }),

    /* Spotlight — see SPOTLIGHTS const + currentSpotlight memo above.
       The row's theme rotates per session via the sessionSeed-driven
       index. fallbackPool=universalPool keeps it visible on degraded
       APIs without the user noticing the slot is sometimes empty. */
    spotlight: sliceDiscovery(spotlightGames, {
      rowKey: `spotlight:${currentSpotlight.key}`,
      tier: 2,
      fallbackPool: universalPool,
    }),

    /* ── TIER 4 — Deep discovery tags (dedup'd within tier 4) ── */
    pixelArt: sliceDiscovery(tagData["pixelArt"] ?? [], {
      rowKey: "t:pixelArt",
      tier: 4,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    sciFi: sliceDiscovery(tagData["sciFi"] ?? [], {
      rowKey: "t:sciFi",
      tier: 4,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    fantasy: sliceDiscovery(tagData["fantasy"] ?? [], {
      rowKey: "t:fantasy",
      tier: 4,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
    survival: sliceDiscovery(tagData["survival"] ?? [], {
      rowKey: "t:survival",
      tier: 4,
      /* universalPool is the LAST-RESORT fallback — only consulted
         when the row's own fetch returned 0 games (sliceDiscovery
         Pass 4). When the genre/tag fetch returned content, Pass 3
         keeps the row on-topic by allowing seen-game repeats from
         the row's OWN games instead. Prevents disappearance in
         degraded environments without leaking popular/hot games
         into themed rows that have real data. */
      fallbackPool: universalPool,
    }),
  };

  /* Skip the personal tier entirely if no signal */
  useEffect(() => {
    if (!hasPersonalSignal && visibleTier === 1) {
      setVisibleTier(2);
    }
  }, [hasPersonalSignal, visibleTier]);

  const handleScrollToTop = () => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* Tag See-All: resolve name → numeric ID, then navigate. If the
     map hasn't loaded yet (or the tag isn't found), navigate to the
     bare catalogue rather than crashing it with an invalid string. */
  const goToTag = (tagName: string) => {
    const id = lookupTagId(tagName);
    goToCatalogue("modern", id != null ? { tags: [id] } : {});
  };

  /* Genre rows always render their plain localized label now. The
     previous behaviour rendered "Because you played [seed]" via
     <PersonalizedTitle/> whenever the genre row was personalised, but
     `seedAssignments` picks the seed by *highest playtime in that
     genre* — NOT by recently played. That gave users 14 rows titled
     "Because you played X" where X was their top-played game per
     genre, which (a) drowned out the dedicated `becauseYouPlayed`
     row (random from last 15 recently played) and `becauseYouLove`
     row (random from top 10 by playtime) so neither was visible
     among the noise, and (b) the seeds shown weren't from their
     "last 15 played" list, which made the titles read as wrong.
     Genre rows now use just `t(fallbackKey)`; the two dedicated
     "Because you ..." rows are the only ones with that title shape. */
  const personalizedOr = (
    _genre: string,
    fallbackKey: string
  ): React.ReactNode => t(fallbackKey);

  /* Library See-All helpers — the Library page reads its active
     collection from `?collection=<id>` (special id `__favorites__`
     opens the Favorites virtual collection) and persists sort to
     `localStorage.library-sort-by` (plain string). */
  const goToLibrary = useCallback(
    (collectionId?: string | null) => {
      const path = collectionId
        ? `/library?collection=${encodeURIComponent(collectionId)}`
        : "/library";
      navigate(path);
    },
    [navigate]
  );

  const goToLibraryRecentlyPlayed = useCallback(() => {
    try {
      localStorage.setItem("library-sort-by", "recently_played");
    } catch {
      /* localStorage can fail in restricted contexts — non-fatal,
         sort just defaults to whatever the user had last. */
    }
    navigate("/library");
  }, [navigate]);

  /* Best-guess collection target for the "From Your Collections" row:
     pick the most-frequent collection ID across the user's library so
     See All opens whatever they actively maintain. Falls back to
     navigating to the bare library if none. */
  const firstCollectionId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of library) {
      if (g.isDeleted || !Array.isArray(g.collectionIds)) continue;
      for (const cid of g.collectionIds) {
        counts.set(cid, (counts.get(cid) ?? 0) + 1);
      }
    }
    let bestId: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
      }
    }
    return bestId;
  }, [library]);

  /* ── Unified row list — every row, one pool ───────────────────
   *
   *  The 6 anchor rows (`FIRST_12_ANCHOR_KEYS`) must land within the
   *  first 12 positions of Home. The user wants them interleaved
   *  with 6 non-anchor rows in that window so the top of Home varies
   *  per refresh rather than locking the same 6 anchors to slots
   *  1-6 every time. Beyond position 12, the remaining pool fills
   *  out to a `TARGET_ROW_COUNT` (30) cap. Adjacency constraints
   *  apply across the whole list via `shuffleWithSeparation`.
   *
   *  The render functions close over the current values of `d`,
   *  `t`, the loading flags, and every other per-render input — so
   *  this assembly runs every render (not inside useMemo). The work
   *  is cheap (≤50 specs, deterministic shuffle keyed by
   *  sessionSeed) and lets new data propagate without staleness. */
  const allSpecs: OrderedRowSpec[] = [];

  /* ─── Tier-0 (discovery/popular) ─────────────────────────── */
  if (userDetails && friendsPlayingGames.length > 0) {
    allSpecs.push({
      id: "friendsPlaying",
      category: "personal",
      render: (delay) => (
        <HomeRow
          title={t("friends_playing_now")}
          games={d.friendsPlaying}
          animationDelay={delay}
        />
      ),
    });
  }
  allSpecs.push({
    id: "hot",
    category: "discovery",
    render: (delay) => (
      <HomeRow
        title={t("popular_on_hydra")}
        games={d.hot}
        isLoading={isLoadingHot}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "mostPlayedHydra",
    category: "discovery",
    render: (delay) => (
      <HomeRow
        title={t("most_played_on_hydra")}
        games={d.mostPlayedHydra}
        isLoading={isLoadingMostPlayedHydra}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "weekly",
    category: "discovery",
    render: (delay) => (
      <HomeRow
        title={t("most_downloaded_this_week")}
        games={d.weekly}
        isLoading={isLoadingWeekly}
        animationDelay={delay}
      />
    ),
  });
  /* "Picks for you" — title-click reshuffles via handleReshuffle. The
     sparkle prefix + refresh-affordance chevron telegraph the re-roll. */
  allSpecs.push({
    id: "randomPicks",
    category: "spotlight",
    render: (delay) => (
      <HomeRow
        title={`✨ ${t("picks_for_you")}`}
        games={randomPicks}
        isLoading={surpriseLoading || randomPicks.length === 0}
        onSeeAll={handleReshuffle}
        titleAffordance="refresh"
        scrollResetSignal={surpriseScrollSignal}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "topReviewed",
    category: "curated",
    render: (delay) => (
      <HomeRow
        /* Title carries an inline Lerna mark sitting between the
           prefix copy and the brand word. Renders through the same
           `personalized-title` class structure that the because-you
           rows use, so the highlight box geometry stays consistent
           with other icon-bearing row titles. The brand word stays
           untranslated ("Lerna"); only the prefix copy goes through
           i18n. */
        title={
          <span className="personalized-title">
            <span className="personalized-title__text">
              {t("top_reviewed_on_prefix")}
            </span>
            <img
              src={lernaLogo}
              alt=""
              aria-hidden="true"
              className="personalized-title__icon"
              loading="lazy"
            />
            <span className="personalized-title__text personalized-title__text--game">
              Lerna
            </span>
          </span>
        }
        games={d.topReviewed}
        isLoading={isLoadingTopReviewed}
        prefixNode={<LernaPromoCard />}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "recentlyAdded",
    category: "discovery",
    render: (delay) => (
      <HomeRow
        title={t("recently_added")}
        games={d.recentlyAdded}
        isLoading={isLoadingPrimary}
        onSeeAll={() =>
          goToCatalogue("modern", {
            sortBy: "releaseDate",
            sortOrder: "desc",
          })
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "hiddenGems",
    category: "discovery",
    render: (delay) => (
      <HomeRow
        title={t("hidden_gems")}
        games={d.hiddenGems}
        isLoading={isLoadingPrimary}
        cardStyle="vertical"
        animationDelay={delay}
      />
    ),
  });

  /* ─── Personal library rows ──────────────────────────────── */
  if (hasPersonalSignal) {
    allSpecs.push({
      id: "recentlyPlayed",
      category: "personal",
      render: (delay) => (
        <HomeRow
          title={t("recently_played")}
          games={d.recentlyPlayed}
          onSeeAll={goToLibraryRecentlyPlayed}
          animationDelay={delay}
          cardStyle="recently-played"
        />
      ),
    });
    allSpecs.push({
      id: "favorites",
      category: "personal",
      render: (delay) => (
        <HomeRow
          title={t("based_on_your_favorites")}
          games={d.favorites}
          onSeeAll={() => goToLibrary("__favorites__")}
          animationDelay={delay}
        />
      ),
    });
    /* "Games to beat" — achievement-progress row. Only included when
       the user has at least one game with partial achievement progress
       (gate on length here, NOT in HomeRow, so a user with no in-
       progress games doesn't see a permanently-empty slot). */
    if (d.gamesToBeat.length > 0) {
      allSpecs.push({
        id: "gamesToBeat",
        category: "personal",
        render: (delay) => (
          <HomeRow
            title={t("games_to_beat")}
            games={d.gamesToBeat}
            animationDelay={delay}
          />
        ),
      });
    }
    /* "Because you played X" — one spec per seed picked from the
       user's last 15 recently-played titles. Each row has its own
       seed, its own title, and its own similar-games pool (with a
       hot-games fallback so it never renders empty). All share the
       `personal` category tag so the adjacency shuffler spreads them
       across the home order alongside other personal rows. The id
       interpolates the seed's objectId so React keeps each row
       stable across refreshes and the shuffle treats them as
       distinct entries. */
    /* Click handler shared by both "Because you played X" and
       "Because you love X" rows. Navigates to the catalogue with
       the SEED GAME'S top genres as a filter — same shape the genre
       rows already use (`goToCatalogue("modern", { genres: ["RPG"] })`).
       This gives the user a real catalogue surface filtered to the
       genre that the row is themed on, not just a title search.

       `libraryGameGenres` (populated by cross-referencing every
       catalogue-fetched row in memory against the user's library)
       is the synchronous source of truth for "what genres does this
       seed game belong to?". Top 2 genres are passed because the
       catalogue ANDs the genre filter — narrower, more on-topic
       than top 1 alone. If the map has nothing for this seed (e.g.
       a library game that never surfaced in any fetched row), we
       fall back to a title search so the click STILL goes somewhere
       useful instead of opening an unfiltered catalogue. */
    const goToCatalogueForSeed = (seed: LibraryGame) => {
      const gs = libraryGameGenres.get(seed.objectId);
      if (gs && gs.length > 0) {
        goToCatalogue("modern", { genres: gs.slice(0, 2) });
      } else {
        goToCatalogue("modern", { title: seed.title });
      }
    };
    for (const seed of becauseYouPlayedSeeds) {
      const games = d.playedGamesBySeed.get(seed.objectId) ?? [];
      /* No `length === 0` skip — we MUST push every seed's spec
         unconditionally, otherwise the row drops permanently if the
         similar-games fetch hasn't resolved yet at the moment d was
         built (the spec list is only assembled once per render).
         sliceDiscovery's hot-games fallback chain in the d-level
         playedGamesBySeed construction handles the empty case; while
         we wait for first data, HomeRow shows skeleton bones via the
         isHydrating context. */
      allSpecs.push({
        id: `becauseYouPlayed:${seed.objectId}`,
        category: "personal",
        render: (delay) => (
          <HomeRow
            title={
              <PersonalizedTitle
                game={seed}
                prefixKey="because_you_played_prefix"
              />
            }
            games={games}
            isLoading={games.length === 0}
            onSeeAll={() => goToCatalogueForSeed(seed)}
            animationDelay={delay}
          />
        ),
      });
    }
    /* "Because you love X" — same per-seed expansion as
       becauseYouPlayed above, but seeded from the user's top 10 by
       playtime (with overlap with played seeds already filtered out
       at the seed-array level). */
    for (const seed of becauseYouLoveSeeds) {
      const games = d.loveGamesBySeed.get(seed.objectId) ?? [];
      allSpecs.push({
        id: `becauseYouLove:${seed.objectId}`,
        category: "personal",
        render: (delay) => (
          <HomeRow
            title={
              <PersonalizedTitle
                game={seed}
                prefixKey="because_you_love_prefix"
              />
            }
            games={games}
            isLoading={games.length === 0}
            onSeeAll={() => goToCatalogueForSeed(seed)}
            animationDelay={delay}
          />
        ),
      });
    }
    allSpecs.push({
      id: "collections",
      category: "personal",
      render: (delay) => (
        <HomeRow
          title={t("from_your_collections")}
          games={d.collections}
          onSeeAll={() => goToLibrary(firstCollectionId)}
          animationDelay={delay}
        />
      ),
    });
    allSpecs.push({
      id: "library",
      category: "personal",
      render: (delay) => (
        <HomeRow
          title={t("from_your_library")}
          games={d.library}
          onSeeAll={() => goToLibrary()}
          animationDelay={delay}
        />
      ),
    });
  }

  /* ─── Themed discovery rows — genres, tags, classics ───── */
  allSpecs.push({
    id: "action",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Action", "action_games")}
        games={d.action}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["Action"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "open-world",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("open_world_games")}
        games={d.openWorld}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Open World")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "indie",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Indie", "indie_games")}
        games={d.indie}
        isLoading={isLoadingGenres || isLoadingHot}
        cardStyle="vertical"
        onSeeAll={() => goToCatalogue("modern", { genres: ["Indie"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "adventure",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Adventure", "adventure_games")}
        games={d.adventure}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["Adventure"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "story-rich",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("story_rich_games")}
        games={d.storyRich}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Story Rich")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "rpg",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("RPG", "rpg")}
        games={d.rpg}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["RPG"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "co-op",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("co_op_games")}
        games={d.coOp}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Co-op")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "critically-acclaimed",
    category: "curated",
    render: (delay) => (
      <HomeRow
        title={t("critically_acclaimed")}
        games={d.criticallyAcclaimed}
        isLoading={isLoadingHot && criticallyAcclaimedGames.length === 0}
        onSeeAll={() =>
          goToCatalogue("modern", {
            sortBy: "reviewScore",
            sortOrder: "desc",
          })
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "spotlight",
    category: "spotlight",
    render: (delay) => (
      <HomeRow
        title={t(currentSpotlight.titleKey)}
        games={d.spotlight}
        isLoading={isLoadingHot && spotlightGames.length === 0}
        onSeeAll={() =>
          goToCatalogue("modern", {
            ...currentSpotlight.filter,
            genres:
              "genres" in currentSpotlight.filter
                ? [...currentSpotlight.filter.genres]
                : undefined,
          } as Partial<CatalogueSearchPayload>)
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "brand-new",
    category: "curated",
    render: (delay) => (
      <HomeRow
        title={t("brand_new_releases")}
        games={d.brandNew}
        isLoading={isLoadingHot && brandNewGames.length === 0}
        onSeeAll={() =>
          goToCatalogue("modern", {
            sortBy: "releaseDate",
            sortOrder: "desc",
          })
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "strategy",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Strategy", "strategy_games")}
        games={d.strategy}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["Strategy"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "pixel-art",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("pixel_art_games")}
        games={d.pixelArt}
        isLoading={isLoadingTags || isLoadingHot}
        cardStyle="vertical"
        onSeeAll={() => goToTag("Pixel Graphics")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps1",
    category: "classics-platform",
    platform: "ps1",
    render: (delay) => (
      <HomeRow
        title={
          <PlatformTitle
            system="ps1"
            prefix={t("popular_prefix")}
            label={t("games_suffix")}
          />
        }
        games={d.ps1}
        isLoading={isLoadingPlatformClassics && ps1Games.length === 0}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps1 ? { platforms: [platformKeys.ps1] } : {}
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "simulation",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Simulation", "simulation_games")}
        games={d.simulation}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["Simulation"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "souls-like",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("souls_like_games")}
        games={d.soulsLike}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Souls-like")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "horror",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Horror", "horror_games")}
        games={d.horror}
        isLoading={isLoadingGenres || isLoadingHot}
        /* Horror is a tag, not a catalogue genre (see
           PSEUDO_GENRE_TAGS comment). Routing through goToTag
           resolves the name → numeric tag ID before navigating, so
           the catalogue actually applies the filter on landing. */
        onSeeAll={() => goToTag("Horror")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "racing",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Racing", "racing_games")}
        games={d.racing}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["Racing"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "sci-fi",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("sci_fi_games")}
        games={d.sciFi}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Sci-fi")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "retro",
    category: "curated",
    render: (delay) => (
      <HomeRow
        title={t("retro_games")}
        games={d.retro}
        isLoading={
          (isLoadingClassics || isLoadingHot) && retroMixedPool.length === 0
        }
        onSeeAll={() =>
          goToCatalogue("modern", {
            releaseYear: { lte: RETRO_PC_BEFORE_YEAR },
          })
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps1-rpg",
    category: "classics-genre",
    platform: "ps1",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps1" label={t("rpg_classics")} />}
        games={d.ps1Rpg}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps1
              ? { platforms: [platformKeys.ps1], genres: ["RPG"] }
              : { genres: ["RPG"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps1-action",
    category: "classics-genre",
    platform: "ps1",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps1" label={t("action_classics")} />}
        games={d.ps1Action}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps1
              ? { platforms: [platformKeys.ps1], genres: ["Action"] }
              : { genres: ["Action"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps1-platformer",
    category: "classics-genre",
    platform: "ps1",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps1" label={t("platformer_classics")} />}
        games={d.ps1Platformer}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps1
              ? { platforms: [platformKeys.ps1], genres: ["Platformer"] }
              : { genres: ["Platformer"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps1-fighting",
    category: "classics-genre",
    platform: "ps1",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps1" label={t("fighting_classics")} />}
        games={d.ps1Fighting}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps1
              ? { platforms: [platformKeys.ps1], genres: ["Fighting"] }
              : { genres: ["Fighting"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps1-adventure",
    category: "classics-genre",
    platform: "ps1",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps1" label={t("adventure_classics")} />}
        games={d.ps1Adventure}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps1
              ? { platforms: [platformKeys.ps1], genres: ["Adventure"] }
              : { genres: ["Adventure"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "browse-classics",
    category: "curated",
    render: (delay) => (
      <HomeRow
        title={t("browse_classics")}
        games={d.browseClassics}
        isLoading={
          (isLoadingClassics || isLoadingPlatformClassics) &&
          browseClassicsPool.length === 0
        }
        cardStyle="vertical"
        onSeeAll={() => goToCatalogue("classics")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps2",
    category: "classics-platform",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={
          <PlatformTitle
            system="ps2"
            prefix={t("popular_prefix")}
            label={t("games_suffix")}
          />
        }
        games={d.ps2}
        isLoading={isLoadingPlatformClassics && ps2Games.length === 0}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2 ? { platforms: [platformKeys.ps2] } : {}
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "sports",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Sports", "sports_games")}
        games={d.sports}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["Sports"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "fantasy",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("fantasy_games")}
        games={d.fantasy}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Fantasy")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "puzzle",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Puzzle", "puzzle_games")}
        games={d.puzzle}
        isLoading={isLoadingGenres || isLoadingHot}
        cardStyle="vertical"
        onSeeAll={() => goToTag("Puzzle")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "casual",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Casual", "casual_games")}
        games={d.casual}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToCatalogue("modern", { genres: ["Casual"] })}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "mm",
    category: "genre",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Massively Multiplayer", "massively_multiplayer")}
        games={d.mm}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() =>
          goToCatalogue("modern", { genres: ["Massively Multiplayer"] })
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "fighting",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Fighting", "fighting_games")}
        games={d.fighting}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToTag("Fighting")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "survival",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("survival_games")}
        games={d.survival}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Survival")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "platformers",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={personalizedOr("Platformer", "platformer_games")}
        games={d.platformers}
        isLoading={isLoadingGenres || isLoadingHot}
        onSeeAll={() => goToTag("Platformer")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "roguelite",
    category: "tag",
    render: (delay) => (
      <HomeRow
        title={t("roguelite_games")}
        games={d.roguelite}
        isLoading={isLoadingTags || isLoadingHot}
        onSeeAll={() => goToTag("Rogue-lite")}
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3",
    category: "classics-platform",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={
          <PlatformTitle
            system="ps3"
            prefix={t("popular_prefix")}
            label={t("games_suffix")}
          />
        }
        games={d.ps3}
        isLoading={isLoadingPlatformClassics && ps3Games.length === 0}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3 ? { platforms: [platformKeys.ps3] } : {}
          )
        }
        animationDelay={delay}
      />
    ),
  });

  /* ── Dynamic per-platform classic rows ──────────────────────
        One row per launchbox platform OTHER than PS1/PS2/PS3 whose
        fetch returned non-empty results. PlatformTitle is typed to
        EmulatorSystem (ps1/ps2/ps3) so we use a plain composed title
        here: "Popular {platform name} games". The category tag stays
        "classics-platform" so the existing per-category minimums logic
        promotes them into refresh slots alongside the PS rows. */
  for (const platform of launchboxFilters.platforms) {
    if (platformToSystem(platform.name) !== null) continue; // PS handled above
    const games = extraPlatformGames[platform.key];
    if (!games || games.length === 0) continue;
    const platformLabel = platform.name;
    const platformKey = platform.key;
    const sliced = sliceDiscovery(games, {
      rowKey: `platform:${platformKey}`,
      tier: 2,
    });
    if (sliced.length === 0) continue;
    allSpecs.push({
      id: `platform:${platformKey}`,
      category: "classics-platform",
      render: (delay) => (
        <HomeRow
          title={`${t("popular_prefix")} ${platformLabel} ${t("games_suffix")}`}
          games={sliced}
          onSeeAll={() =>
            goToCatalogue("classics", { platforms: [platformKey] })
          }
          animationDelay={delay}
        />
      ),
    });
  }
  allSpecs.push({
    id: "ps2-horror",
    category: "classics-genre",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps2" label={t("horror_classics")} />}
        games={d.ps2Horror}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2
              ? { platforms: [platformKeys.ps2], genres: ["Horror"] }
              : { genres: ["Horror"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps2-action",
    category: "classics-genre",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps2" label={t("action_classics")} />}
        games={d.ps2Action}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2
              ? { platforms: [platformKeys.ps2], genres: ["Action"] }
              : { genres: ["Action"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3-action",
    category: "classics-genre",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps3" label={t("action_classics")} />}
        games={d.ps3Action}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3
              ? { platforms: [platformKeys.ps3], genres: ["Action"] }
              : { genres: ["Action"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3-rpg",
    category: "classics-genre",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps3" label={t("rpg_classics")} />}
        games={d.ps3Rpg}
        cardStyle="vertical"
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3
              ? { platforms: [platformKeys.ps3], genres: ["RPG"] }
              : { genres: ["RPG"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3-adventure",
    category: "classics-genre",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps3" label={t("adventure_classics")} />}
        games={d.ps3Adventure}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3
              ? { platforms: [platformKeys.ps3], genres: ["Adventure"] }
              : { genres: ["Adventure"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps2-rpg",
    category: "classics-genre",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps2" label={t("rpg_classics")} />}
        games={d.ps2Rpg}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2
              ? { platforms: [platformKeys.ps2], genres: ["RPG"] }
              : { genres: ["RPG"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  /* Extra PS2 + PS3 genre rows. Each goes through HomeRow's empty-
     state auto-hide, so they only surface when the per-(platform,
     genre) fetch returns at least one game. Categorising them under
     `classics-genre` + the right `platform` tag means the shuffler's
     same-platform spread and the theme-family adjacency rule both
     apply automatically. */
  allSpecs.push({
    id: "ps2-adventure",
    category: "classics-genre",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps2" label={t("adventure_classics")} />}
        games={d.ps2Adventure}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2
              ? { platforms: [platformKeys.ps2], genres: ["Adventure"] }
              : { genres: ["Adventure"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps2-platformer",
    category: "classics-genre",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps2" label={t("platformer_classics")} />}
        games={d.ps2Platformer}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2
              ? { platforms: [platformKeys.ps2], genres: ["Platformer"] }
              : { genres: ["Platformer"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps2-fighting",
    category: "classics-genre",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps2" label={t("fighting_classics")} />}
        games={d.ps2Fighting}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2
              ? { platforms: [platformKeys.ps2], genres: ["Fighting"] }
              : { genres: ["Fighting"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps2-racing",
    category: "classics-genre",
    platform: "ps2",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps2" label={t("racing_classics")} />}
        games={d.ps2Racing}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps2
              ? { platforms: [platformKeys.ps2], genres: ["Racing"] }
              : { genres: ["Racing"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3-horror",
    category: "classics-genre",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps3" label={t("horror_classics")} />}
        games={d.ps3Horror}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3
              ? { platforms: [platformKeys.ps3], genres: ["Horror"] }
              : { genres: ["Horror"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3-platformer",
    category: "classics-genre",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps3" label={t("platformer_classics")} />}
        games={d.ps3Platformer}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3
              ? { platforms: [platformKeys.ps3], genres: ["Platformer"] }
              : { genres: ["Platformer"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3-fighting",
    category: "classics-genre",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps3" label={t("fighting_classics")} />}
        games={d.ps3Fighting}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3
              ? { platforms: [platformKeys.ps3], genres: ["Fighting"] }
              : { genres: ["Fighting"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });
  allSpecs.push({
    id: "ps3-racing",
    category: "classics-genre",
    platform: "ps3",
    render: (delay) => (
      <HomeRow
        title={<PlatformTitle system="ps3" label={t("racing_classics")} />}
        games={d.ps3Racing}
        onSeeAll={() =>
          goToCatalogue(
            "classics",
            platformKeys.ps3
              ? { platforms: [platformKeys.ps3], genres: ["Racing"] }
              : { genres: ["Racing"] }
          )
        }
        animationDelay={delay}
      />
    ),
  });

  /* Dev-only sanity check: if the pool is below the 30-row target the
     bottom of Home will fall short. Visible in DevTools console only,
     stripped from prod via the import.meta.env.DEV gate. */
  if (import.meta.env.DEV && allSpecs.length < TARGET_ROW_COUNT) {
    // eslint-disable-next-line no-console
    console.debug(
      "[home] row pool below target",
      allSpecs.length,
      "<",
      TARGET_ROW_COUNT
    );
  }

  /* ─── Per-session row orientation roll ───────────────────────
   *
   *  Each spec id is independently classified as vertical via a
   *  stable hash of `(id, sessionSeed)`. The earlier Fisher-Yates
   *  approach over the live `allSpecs` list was position-dependent:
   *  when a conditional row arrived mid-session (a fetch finishing
   *  pushed a `gamesToBeat` or platform row into allSpecs), the
   *  shuffle output shifted and every row's vertical/horizontal
   *  decision could flip. That's the layout-instability the user
   *  reported on tab return.
   *
   *  This per-id hash is invariant to list shape: a given spec id
   *  + sessionSeed pair always produces the same answer, so any
   *  spec that was vertical on first render stays vertical even if
   *  more specs appear later. Threshold tuned (≈17.5%) so the total
   *  vertical-row count averages near VERTICAL_ROW_COUNT_PER_REFRESH
   *  (7) across a 40-row refresh. Exact count varies slightly per
   *  session but the user-perceptible "rows don't move" property is
   *  what matters here. `recentlyPlayed` + `topReviewed` are still
   *  exempt (own card variants). */
  const VERTICAL_HASH_THRESHOLD =
    VERTICAL_ROW_COUNT_PER_REFRESH / TARGET_ROW_COUNT;
  const isVerticalRowId = (id: string): boolean => {
    if (id === "recentlyPlayed" || id === "topReviewed") return false;
    let h = (sessionSeed ^ 0xfe) >>> 0 || 1;
    for (let i = 0; i < id.length; i++) {
      h = (Math.imul(h ^ id.charCodeAt(i), 0x6d2b79f5) + h) >>> 0;
    }
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 < VERTICAL_HASH_THRESHOLD;
  };
  const verticalRowIds = new Set(
    allSpecs.filter((s) => isVerticalRowId(s.id)).map((s) => s.id)
  );

  /* Override every spec's isVertical based on the per-session pick.
     This MUST run before `shuffleWithSeparation` below so the
     adjacency walker can keep portrait rows from clumping. */
  for (const spec of allSpecs) {
    spec.isVertical = verticalRowIds.has(spec.id);
  }

  /* Resolve the cardStyle a row should render with this refresh.
     `recentlyPlayed` keeps its dedicated card variant; everything
     else flips between horizontal and vertical per the set above. */
  const cardStyleFor = (
    id: string
  ): "horizontal" | "vertical" | "recently-played" => {
    if (id === "recentlyPlayed") return "recently-played";
    return verticalRowIds.has(id) ? "vertical" : "horizontal";
  };

  /* ─── Ordering: 6 anchors mixed into the top-12 ──────────
   *
   *  1. Split the pool into anchors (6 IDs in
   *     FIRST_12_ANCHOR_KEYS that survived the personal-signal
   *     filter above) and non-anchors.
   *  2. Pre-shuffle the non-anchors with the adjacency walker;
   *     take the first (12 − anchors.length) for the top window,
   *     the rest spill below.
   *  3. Combine anchors + sampled top non-anchors → shuffle the
   *     combined 12 with adjacency constraints so anchors can land
   *     anywhere within slots 1-12 (intermixed with non-anchors).
   *  4. The non-anchor leftovers form the bottom of Home.
   *  5. Final list is capped at TARGET_ROW_COUNT. The Hero already
   *     sits above all of this; row 1 in the list is the first
   *     row below the Hero. */
  /* The shuffler is the dominant per-render cost in this section:
     three `shuffleWithSeparation` walkers, each O(N²) over the spec
     pool. Wrap the ordering work in useMemo keyed off a lightweight
     stable signature of the spec metadata the shuffler actually reads
     (id + category + isVertical + platform) plus sessionSeed. As long
     as the set of available rows doesn't change shape and the session
     hasn't re-rolled, the cached order is reused — even when the
     full `allSpecs` rebuilds with fresh closures.

     The cached result is an ARRAY OF SPEC IDs (string), NOT an array
     of spec objects. We then look up the live spec objects from
     `allSpecs` by id below — so the rendered closures stay current
     while the expensive order computation is skipped. */
  const orderSignature = allSpecs
    .map(
      (s) => `${s.id}|${s.category}|${s.isVertical ? 1 : 0}|${s.platform ?? ""}`
    )
    .join("/");
  const cachedRowOrder = useMemo<string[]>(() => {
    const anchorSpecs = allSpecs.filter((s) => FIRST_12_ANCHOR_KEYS.has(s.id));
    const nonAnchorSpecs = allSpecs.filter(
      (s) => !FIRST_12_ANCHOR_KEYS.has(s.id)
    );
    const shuffledNonAnchors = shuffleWithSeparation(
      nonAnchorSpecs,
      sessionSeed ^ 0xa
    );

    /* ─── Per-category minimums ──────────────────────────────────
     *  The user wants every refresh to surface at least:
     *    • 3 genre rows
     *    • 3 classics-platform rows (Popular PS1/PS2/PS3)
     *    • 3 classics-genre rows (PS1 RPG Classics, PS2 Horror, etc.)
     *  Without this enforcement, a 40-slot Fisher-Yates pick from
     *  ~50 candidate specs gave classics-platform a ~35% chance of
     *  ALL three being included on any given refresh — the user saw
     *  refreshes with 0 or 1 classic-platform rows and complained the
     *  home felt repetitive.
     *
     *  Strategy: walk the shuffled non-anchors and force-promote the
     *  first N of each minimum-category to the front of the selection
     *  pool. The shuffle order within each category is preserved
     *  (sessionSeed-deterministic), so different refreshes still pick
     *  DIFFERENT specific rows from each category — just guarantees
     *  the COUNT.
     *
     *  Slots are budgeted: anchors (≤6) + minimums (≤9) = ≤15 of the
     *  40-row body, leaving 25 free for variety picks across all
     *  categories. */
    const CATEGORY_MINIMUMS: Record<string, number> = {
      genre: 3,
      "classics-platform": 3,
      "classics-genre": 3,
    };
    const promotedIds = new Set<string>();
    const promoted: typeof shuffledNonAnchors = [];
    for (const [cat, min] of Object.entries(CATEGORY_MINIMUMS)) {
      let added = 0;
      for (const spec of shuffledNonAnchors) {
        if (added >= min) break;
        if (promotedIds.has(spec.id)) continue;
        if (spec.category !== cat) continue;
        promoted.push(spec);
        promotedIds.add(spec.id);
        added++;
      }
    }
    const remainderNonAnchors = shuffledNonAnchors.filter(
      (s) => !promotedIds.has(s.id)
    );
    /* Promoted rows go FIRST in the selection budget so they survive
     the TARGET_ROW_COUNT slice. We re-shuffle (with adjacency) at
     the top-window + body steps below so they don't visually clump. */
    const budgetedNonAnchors = [...promoted, ...remainderNonAnchors];

    const nonAnchorsForTop = Math.max(0, TOP_WINDOW_SIZE - anchorSpecs.length);
    const topNonAnchors = budgetedNonAnchors.slice(0, nonAnchorsForTop);
    const restNonAnchors = budgetedNonAnchors.slice(nonAnchorsForTop);
    const topWindow = shuffleWithSeparation(
      [...anchorSpecs, ...topNonAnchors],
      sessionSeed ^ 0xb
    );
    /* Re-shuffle the body too so promoted minimums (currently at the
     front of restNonAnchors) get distributed through the middle/end
     of the home, not stacked together. Adjacency constraints stop
     same-category clumping after the re-shuffle. */
    const shuffledRest = shuffleWithSeparation(
      restNonAnchors,
      sessionSeed ^ 0xc
    );
    return [...topWindow, ...shuffledRest]
      .slice(0, TARGET_ROW_COUNT)
      .map((s) => s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSignature, sessionSeed]);

  /* Resolve the cached order back to live spec objects (with current
     render closures attached). Map-based lookup is O(1) per id. */
  const specsById = new Map(allSpecs.map((s) => [s.id, s]));
  const orderedRows = cachedRowOrder
    .map((id) => specsById.get(id))
    .filter((s): s is OrderedRowSpec => s != null);

  /* Tier-sliced row mounting — only mount rows up to the highest
     unlocked tier. Mounting all 40 rows up-front meant every drag /
     hover paid for 40 HomeRow component trees worth of state, refs,
     IntersectionObservers, and skeleton DOM at once — exactly the
     "fluid when first rows render, laggy when all render" report
     from the user.
     The previous reason for mounting all rows up-front was "fast
     vertical scrolls beat the tier sentinel and showed a black
     gap"; the tier sentinels' rootMargin has since been bumped to
     4000px (down in the per-tier sentinel observer) which gives
     even fast scrolls enough lookahead for the next tier to mount
     before it scrolls into view. */
  const tierEnd =
    visibleTier >= MAX_TIER
      ? orderedRows.length
      : TIER_START_INDICES[visibleTier + 1];
  const renderedRows = orderedRows.slice(0, tierEnd);

  return (
    <HomeHydrationContext.Provider value={isHydrating}>
      <HomeFriendsProvider value={friendsByGameKey}>
        <HomeScrollStateContext.Provider value={homeScrollState}>
          <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
            <section ref={contentRef} className="home__content">
              <Hero
                /* 9 game-backed candidate kinds, all equal-weight. Hero
             shuffles the 9 kinds and takes the first 5 that produce
             a renderable slide — drawing fresh on every fresh-launch
             ≥30-min refresh via `sessionSeed`. The `hot-now` slot is
             no longer mandatory but keeps its popularity-precision
             resolver (popularityRanking ∩ /catalogue/featured) so
             when it IS drawn it still surfaces the curated featured
             entry that's most popular right now. */
                candidates={(() => {
                  const out: HeroCandidate[] = [];
                  const used = new Set<string>();
                  const claim = (g: HomeRowGame) => {
                    const k = `${g.shop}:${g.objectId}`;
                    if (used.has(k)) return false;
                    used.add(k);
                    return true;
                  };

                  /* The Hero's PC slide builder requires `logoImageUrl`
               AND a hero/library image, otherwise it silently drops
               the slide. Filter discovery candidates before pushing. */
                  const hasPcAssets = (g: HomeRowGame) =>
                    !!g.logoImageUrl &&
                    !!(g.libraryHeroImageUrl ?? g.libraryImageUrl);

                  /* Classics-aware variant. A classic slide is valid as
               long as it has a cover (the Hero's classics builder
               only requires `coverImageUrl ?? libraryImageUrl`). PC
               games still need the strict hero+logo combo. Used by
               the because-you-played slot so a classic seed's
               classic similar games can surface. */
                  const hasDisplayableAssets = (g: HomeRowGame) => {
                    if (g.shop === "launchbox") {
                      return !!(g.coverImageUrl ?? g.libraryImageUrl);
                    }
                    return hasPcAssets(g);
                  };

                  /* ── hot-now — most popular game right now. Walk the hot
                  pool until we find one with PC assets so the Hero
                  never has to fall back. */
                  for (const g of hotGames) {
                    if (!hasPcAssets(g)) continue;
                    if (!claim(g)) continue;
                    out.push({ kind: "hot-now", game: g });
                    break;
                  }

                  /* ── recently-played — library game played in the last
                  7 days, surfaced with capped weekly hours.
                  Approximated from cumulative play time (no per-day
                  session breakdown exists on LibraryGame). */
                  if (hasPersonalSignal) {
                    const WEEKLY_HOURS_CAP = 20;
                    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                    const recentlyActive = library
                      .filter(
                        (g) =>
                          !g.isDeleted &&
                          (g.playTimeInMilliseconds ?? 0) > 0 &&
                          g.lastTimePlayed != null &&
                          new Date(g.lastTimePlayed).getTime() >= sevenDaysAgo
                      )
                      .sort(
                        (a, b) =>
                          (b.playTimeInMilliseconds ?? 0) -
                          (a.playTimeInMilliseconds ?? 0)
                      );
                    for (const cand of recentlyActive) {
                      const row = libraryGameToRowGame(cand);
                      if (!claim(row)) continue;
                      const totalHours =
                        (cand.playTimeInMilliseconds ?? 0) / (1000 * 60 * 60);
                      out.push({
                        kind: "recently-played",
                        game: row,
                        becauseOfTitle: cand.title,
                        hoursThisWeek: Math.min(totalHours, WEEKLY_HOURS_CAP),
                      });
                      break;
                    }
                  }

                  /* ── most-downloaded-this-week — top weekly catalogue
                  game with PC assets. Cross-fall back to other
                  catalogue pools so the slot doesn't go dark when
                  the weekly endpoint hasn't resolved yet. */
                  const downloadedSources: HomeRowGame[][] = [
                    weeklyGames,
                    recentlyAddedGames,
                    hotGames,
                    topReviewedGames,
                  ];
                  md_outer: for (const src of downloadedSources) {
                    for (const g of src) {
                      if (!hasPcAssets(g)) continue;
                      if (!claim(g)) continue;
                      out.push({ kind: "most-downloaded-this-week", game: g });
                      break md_outer;
                    }
                  }

                  /* ── random-pick — a genuinely random game from the
                  union pool, includes both PC AND classics. The
                  previous "start-index walk" picked the first PC-
                  asset-having game from `sessionSeed % length`,
                  which (a) skipped classics entirely because
                  `hasPcAssets` requires logoImageUrl + hero image
                  (classics rarely have both), and (b) wasn't really
                  random — runs of PC games near the start index
                  always won. Replaced with a Fisher-Yates shuffle of
                  the union pool + the classics-aware asset gate, so
                  any game with displayable assets has a fair shot. */
                  const randomPool = randomPicksPool ?? [];
                  if (randomPool.length > 0) {
                    const shuffled = randomPool.slice();
                    let s = (sessionSeed ^ 0x99) >>> 0 || 1;
                    const rng = () => {
                      s = (s + 0x6d2b79f5) | 0;
                      let t = s;
                      t = Math.imul(t ^ (t >>> 15), t | 1);
                      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                    };
                    for (let i = shuffled.length - 1; i > 0; i--) {
                      const j = Math.floor(rng() * (i + 1));
                      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    for (const g of shuffled) {
                      if (!hasDisplayableAssets(g)) continue;
                      if (!claim(g)) continue;
                      out.push({ kind: "random-pick", game: g });
                      break;
                    }
                  }

                  /* ── from-library — random PC game from the user's
                  library (excluding classics, so this kind doesn't
                  collide with good-old-days / hot-now-classics). */
                  if (hasPersonalSignal) {
                    const libPc = library.filter(
                      (g) => !g.isDeleted && g.shop !== "launchbox"
                    );
                    if (libPc.length > 0) {
                      const idx = sessionSeed % libPc.length;
                      for (let i = 0; i < libPc.length; i++) {
                        const cand = libPc[(idx + i) % libPc.length];
                        const row = libraryGameToRowGame(cand);
                        if (!claim(row)) continue;
                        out.push({
                          kind: "from-library",
                          game: row,
                          becauseOfTitle: cand.title,
                        });
                        break;
                      }
                    }
                  }

                  /* ── good-old-days — random classics from the user's
                  library. */
                  if (hasPersonalSignal) {
                    const libClassics = library.filter(
                      (g) => !g.isDeleted && g.shop === "launchbox"
                    );
                    if (libClassics.length > 0) {
                      const idx = (sessionSeed ^ 0x5a5a) % libClassics.length;
                      for (let i = 0; i < libClassics.length; i++) {
                        const cand =
                          libClassics[(idx + i) % libClassics.length];
                        const row = libraryGameToRowGame(cand);
                        if (!claim(row)) continue;
                        out.push({ kind: "good-old-days", game: row });
                        break;
                      }
                    }
                  }

                  /* ── hot-now-classics — another random classic from the
                  library, different from good-old-days. (We can't
                  measure "popular classics right now" until we wire
                  that data — for now it surfaces a second classics
                  pick so the kind is reachable on rolls when the
                  library has ≥2 classics.) */
                  if (hasPersonalSignal) {
                    const libClassics = library.filter(
                      (g) => !g.isDeleted && g.shop === "launchbox"
                    );
                    if (libClassics.length >= 2) {
                      const idx = (sessionSeed ^ 0xa5a5) % libClassics.length;
                      for (let i = 0; i < libClassics.length; i++) {
                        const cand =
                          libClassics[(idx + i) % libClassics.length];
                        const row = libraryGameToRowGame(cand);
                        if (!claim(row)) continue;
                        out.push({ kind: "hot-now-classics", game: row });
                        break;
                      }
                    }
                  }

                  /* ── trophy-hunter — most-recently-played library game
                  where the user has unlocked at least one
                  achievement. No per-achievement timestamp exists
                  on LibraryGame, so we use lastTimePlayed as a
                  proxy: the most-recently-played game with any
                  unlocks is approximately "where the user is
                  earning trophies right now". */
                  if (hasPersonalSignal) {
                    const withTrophies = library
                      .filter(
                        (g) =>
                          !g.isDeleted &&
                          (g.unlockedAchievementCount ?? 0) > 0 &&
                          g.lastTimePlayed != null
                      )
                      .sort(
                        (a, b) =>
                          new Date(
                            b.lastTimePlayed as string | Date
                          ).getTime() -
                          new Date(a.lastTimePlayed as string | Date).getTime()
                      );
                    for (const cand of withTrophies) {
                      const row = libraryGameToRowGame(cand);
                      if (!claim(row)) continue;
                      out.push({
                        kind: "trophy-hunter",
                        game: row,
                        becauseOfTitle: cand.title,
                      });
                      break;
                    }
                  }

                  /* ── because-you-played — surface a related game keyed
                  off a random pick from the user's last 15 recently-
                  played titles (PC or classics; computed once per
                  session in `becauseYouPlayedSeed`). Reads from
                  `allSimilarBySeed` so classics surface too: a
                  classic seed yields classic similar games (matched
                  by platform + optional genre), a PC seed yields
                  PC + on-genre classics. The asset check is
                  classics-aware so a classic similar game with just
                  a cover is accepted. */
                  if (hasPersonalSignal && becauseYouPlayedSeed) {
                    const similar =
                      allSimilarBySeed.get(becauseYouPlayedSeed.objectId) ?? [];
                    for (const g of similar) {
                      if (!hasDisplayableAssets(g)) continue;
                      if (!claim(g)) continue;
                      out.push({
                        kind: "because-you-played",
                        game: g,
                        seedGameTitle: becauseYouPlayedSeed.title,
                        seedGameLogoUrl:
                          becauseYouPlayedSeed.logoImageUrl ?? null,
                      });
                      break;
                    }
                  }

                  return out;
                })()}
                /* Session seed — re-rolled on every Hydra launch (the
             outer `homeScrollMemory.sessionSeed` is initialised once
             per JS module load, which IS once per app process =
             once per app open). Used inside the Hero for: (a) the
             candidate-kind shuffle, (b) the final 5-slide order
             shuffle, (c) keying the levelDB cache so cross-launch
             reads are treated as a miss. */
                sessionSeed={sessionSeed}
                /* Popularity ranking — the Hero intersects this with its
             /catalogue/featured response to refine the hot-now
             slide when no candidate-side hot-now was provided,
             preserving the legacy "Hydra's featured pick — but the
             one that's actually popular right now" rule. */
                popularityRanking={hotGames}
                /* Generic discovery fill — used only when the candidate
             pool produces fewer than 2 slides (signed-out / cold
             start). */
                discoveryPicks={[
                  ...hotGames.slice(0, 5),
                  ...topReviewedGames.slice(0, 5),
                  ...recentlyAddedGames.slice(0, 5),
                ]}
                /* Tells the Hero whether to wait for at least one
             personalised candidate to land before persisting the
             session cache. Without this guard the first roll could
             freeze on a discovery-only composition before the
             library candidates resolved. */
                hasLibrarySignal={hasPersonalSignal}
              />

              {/* ── Row list — unified, shuffled, sliced by visibleTier ─
              Anchors land within the first 12 positions but mix
              with non-anchor rows so the top of Home varies per
              refresh. Beyond position 12 the remaining pool spills
              out, capped at TARGET_ROW_COUNT (30). The render of
              each row is the closure captured when allSpecs was
              built above. Tier slicing keeps the lazy-mount
              behaviour: IntersectionObserver bumps `visibleTier`
              and more rows become visible. */}
              {renderedRows.map((spec, i) => {
                /* Inject the per-session cardStyle into the HomeRow the
             spec produced. The spec's render returns a HomeRow
             element (sometimes with a hardcoded cardStyle from
             before this orientation-randomisation pass); cloneElement
             overrides whatever was there with the value from
             `cardStyleFor(spec.id)` so orientation flips per
             refresh. recentlyPlayed always resolves back to
             "recently-played" via that helper, so its dedicated card
             variant is untouched. */
                /* First-mount-only entrance stagger. `isFirstHomeMount` is
             a useState seeded from the module-level `hasMountedHomeBefore`
             flag — true exactly once per renderer process (= once per
             true fresh launch). Subsequent remounts (Home → Library →
             Home) get delay=0 across all rows so the page is visible
             instantly. Without this guard, every remount replayed the
             30-row × 60ms cascade — ≈2s of empty viewport between
             tabbing back and seeing anything. */
                const animDelay = isFirstHomeMount ? i * 60 : 0;
                const rendered = spec.render(animDelay);
                /* Inject cardStyle + skipEntrance via cloneElement so the
             spec callers don't all need to be updated. skipEntrance
             is forced true on every non-first mount so returning to
             Home is instant — see hasMountedHomeBefore module flag
             and the home-row--instant CSS class. */
                const withCardStyle = isValidElement(rendered)
                  ? cloneElement(
                      rendered as ReactElement<{
                        cardStyle?: string;
                        skipEntrance?: boolean;
                      }>,
                      {
                        cardStyle: cardStyleFor(spec.id),
                        skipEntrance: !isFirstHomeMount,
                      }
                    )
                  : rendered;

                return <Fragment key={spec.id}>{withCardStyle}</Fragment>;
              })}

              {/* "Load next tier" sentinel — sits AFTER the last currently
            rendered row. When it scrolls into the 4000px lookahead
            zone, `visibleTier` bumps and the next 10 rows mount,
            pushing this same sentinel down to the new bottom. Loop
            continues until MAX_TIER. Doesn't render once all tiers
            are unlocked — the observer effect early-returns. */}
              {visibleTier < MAX_TIER && (
                <div
                  ref={nextTierSentinelRef}
                  className="home__sentinel"
                  data-tier={visibleTier + 1}
                  aria-hidden="true"
                />
              )}

              {/* Back-to-top button — was previously gated on
            `visibleTier >= MAX_TIER`, which meant if the tier
            sentinels never fired (fast scroll past them, or content
            shorter than the tier ramp) the button silently
            disappeared. Now it sits below the last rendered row
            unconditionally: when more tiers are still pending it
            sits below the partial list; once everything is mounted
            it sits at the true bottom. Either way it's reachable. */}
              <div className="home__back-to-top-container">
                <button
                  type="button"
                  className="home__back-to-top"
                  onClick={handleScrollToTop}
                >
                  ↑ {t("back_to_top")}
                </button>
              </div>
            </section>
          </SkeletonTheme>
        </HomeScrollStateContext.Provider>
      </HomeFriendsProvider>
    </HomeHydrationContext.Provider>
  );
}
