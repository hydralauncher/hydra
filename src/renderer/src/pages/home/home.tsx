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

let hasMountedHomeBefore = false;

const homeScrollMemory: {
  scrollTop: number;
  visibleTier: number;
  sessionSeed: number;
} = {
  scrollTop: 0,
  visibleTier: 0,
  sessionSeed: 0,
};

const SESSION_SEED_IDLE_MS = 30 * 60 * 1000;
const SESSION_SEED_LS_KEY = "hydra:home:session-seed";
const SESSION_SEED_SS_KEY = "hydra:home:session-seed-active";

interface PersistedSessionSeed {
  seed: number;
  ts: number;
}

function refreshSessionSeedIfStale(): { seed: number; wasFresh: boolean } {
  const now = Date.now();

  let inSession = false;
  try {
    inSession = sessionStorage.getItem(SESSION_SEED_SS_KEY) === "1";
  } catch {
    /* sessionStorage unavailable — treat as fresh launch (safer). */
  }

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
  const shouldReroll = isFreshLaunch && isLongIdle;

  let seed: number;
  if (shouldReroll) {
    seed =
      (Math.floor(Math.random() * 1_000_000_000) ^ now ^ (now >>> 16)) >>> 0;
    if (seed === 0) seed = 1;
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

const MAX_ROW_GAMES = 16;
const FETCH_SIZE = 96;
const CLASSICS_FETCH_SIZE = 128;
const POOL_RELAX_THRESHOLD = 8;
const REFETCH_THROTTLE_MS = 2 * 60 * 1000;
const SURPRISE_SKELETON_MS = 520;
const RESHUFFLE_SCROLL_MS = 420;
const SEED_MASK = 0xffffffff;
const MAX_TIER = 3;
const TIER_START_INDICES = [0, 10, 20, 30] as const;
const TARGET_ROW_COUNT = 40;
const VERTICAL_ROW_COUNT_PER_REFRESH = 7;

const FIRST_12_ANCHOR_KEYS = new Set<string>([
  "hot",
  "weekly",
  "randomPicks",
  "mostPlayedHydra",
  "recentlyPlayed",
  "topReviewed",
]);
const TOP_WINDOW_SIZE = 12;

interface OrderedRowSpec extends HomeRowSpec {
  render: (delay: number) => React.ReactNode;
}
const RETRO_PC_BEFORE_YEAR = 2010;

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

const PSEUDO_GENRE_TAGS: Record<string, string> = {
  Puzzle: "Puzzle",
  Fighting: "Fighting",
  Platformer: "Platformer",
  Horror: "Horror",
};

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

const keyOf = (g: { shop: string; objectId: string }) =>
  `${g.shop}:${g.objectId}`;

function hashRowKey(rowKey: string, baseSeed: number): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < rowKey.length; i++) {
    h = Math.imul(h ^ rowKey.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

function pickN<T>(arr: T[], n: number, seed: number): T[] {
  if (arr.length <= n) return arr.slice();
  const indices = Array.from({ length: arr.length }, (_, i) => i);
  const rng = makeRng(seed);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => arr[i]);
}

function seriesKey(title: string): string {
  if (!title) return "";
  let s = title.split(":")[0];
  s = s.replace(/\b([IVX]+|\d+)\b/gi, " ");
  s = s.replace(/[^\w\s]/g, " ");
  s = s.trim().replace(/\s+/g, " ").toLowerCase();
  return s;
}

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

  for (const { item, idx } of overflow) {
    if (picked.length >= n) break;
    picked.push(item);
    pickedIndices.push(idx);
  }

  return pickedIndices
    .map((idx, outIdx) => ({ idx, item: picked[outIdx] }))
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.item);
}

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

const EMPTY_ROW_GAME: HomeRowGame = {
  objectId: "",
  shop: "steam",
  title: "",
};

const libraryGameToRowGame = (g: LibraryGame): HomeRowGame => {
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
    playTimeInMilliseconds: g.playTimeInMilliseconds,
    achievementCount: g.achievementCount,
    unlockedAchievementCount: g.unlockedAchievementCount,
    lastTimePlayed: g.lastTimePlayed,
  };
};

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

export default function Home() {
  const { t } = useTranslation("home");
  const { library: libraryRaw } = useLibrary();
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

  const launchboxFilters = useLaunchboxFilters(true);

  const { userDetails } = useUserDetails();

  useCatalogue();
  const steamUserTags = useAppSelector(
    (state) => state.catalogueSearch.steamUserTags
  );

  const lookupTagId = useCallback(
    (tagName: string): number | null => {
      const map = steamUserTags["en"];
      if (!map) return null;
      const id = map[tagName];
      return typeof id === "number" ? id : null;
    },
    [steamUserTags]
  );

  const [sessionSeed] = useState<number>(() => {
    try {
      const { seed, wasFresh } = refreshSessionSeedIfStale();
      homeScrollMemory.sessionSeed = seed;
      if (wasFresh) {
        homeScrollMemory.scrollTop = 0;
        homeScrollMemory.visibleTier = 0;
      }
      return seed;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[home] sessionSeed roll failed; using fallback", err);
      const fallback =
        (Math.floor(Math.random() * 1_000_000_000) ^ Date.now()) >>> 0 || 1;
      homeScrollMemory.sessionSeed = fallback;
      return fallback;
    }
  });

  const currentSpotlight = useMemo(
    () => SPOTLIGHTS[sessionSeed % SPOTLIGHTS.length],
    [sessionSeed]
  );

  const [isFirstHomeMount] = useState(() => {
    const first = !hasMountedHomeBefore;
    hasMountedHomeBefore = true;
    return first;
  });

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

  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);

  useEffect(() => {
    levelDBService.values("downloadSources").then((results) => {
      const sources = orderBy(results as DownloadSource[], "createdAt", "desc");
      setSourceIds(sources.map((s) => s.id));
      setSourcesLoaded(true);
    });
  }, []);

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
  const [friendsPlayingGames, setFriendsPlayingGames] = useState<HomeRowGame[]>(
    []
  );
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

  const [classicsGames, setClassicsGames] = useState<HomeRowGame[]>([]);
  const [ps1Games, setPs1Games] = useState<HomeRowGame[]>([]);
  const [ps2Games, setPs2Games] = useState<HomeRowGame[]>([]);
  const [ps3Games, setPs3Games] = useState<HomeRowGame[]>([]);
  const [extraPlatformGames, setExtraPlatformGames] = useState<
    Record<string, HomeRowGame[]>
  >({});
  const [
    classicsByPlatformAndGenreFetched,
    setClassicsByPlatformAndGenreFetched,
  ] = useState<Map<string, HomeRowGame[]>>(new Map());
  const [retroPcGames, setRetroPcGames] = useState<HomeRowGame[]>([]);
  const [criticallyAcclaimedGames, setCriticallyAcclaimedGames] = useState<
    HomeRowGame[]
  >([]);
  const [brandNewGames, setBrandNewGames] = useState<HomeRowGame[]>([]);
  const [spotlightGames, setSpotlightGames] = useState<HomeRowGame[]>([]);
  const [genreData, setGenreData] = useState<Record<string, HomeRowGame[]>>({});
  const [tagData, setTagData] = useState<Record<string, HomeRowGame[]>>({});
  const [isLoadingClassics, setIsLoadingClassics] = useState(true);
  const [isLoadingPlatformClassics, setIsLoadingPlatformClassics] =
    useState(true);
  const [isLoadingGenres, setIsLoadingGenres] = useState(true);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  const [isHydrating, setIsHydrating] = useState(true);

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

      setIsHydrating(false);
    });
  }, []);

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

      if (accumulator.length < POOL_RELAX_THRESHOLD && ids.length > 0) {
        const fallback = await postSearch<CatalogueSearchResult>(
          buildSearch(body, [])
        );
        addUnique(fallback);
      }

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

  useEffect(() => {
    if (!sourcesLoaded) return;

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

  const [surpriseSeed, setSurpriseSeed] = useState<number>(
    () => (Math.random() * SEED_MASK) | 0
  );
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  const [surpriseScrollSignal, setSurpriseScrollSignal] = useState(0);
  const surpriseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reshuffleSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const handleReshuffle = useCallback(() => {
    setSurpriseScrollSignal((n) => n + 1);
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
  const nextTierSentinelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    homeScrollMemory.visibleTier = visibleTier;
  }, [visibleTier]);

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

    const rafId = requestAnimationFrame(apply);

    const ro = new ResizeObserver(() => {
      if (userInterrupted) return;
      apply();
    });
    ro.observe(el);
    for (const child of Array.from(el.children)) {
      if (child instanceof HTMLElement) ro.observe(child);
    }

    const t1 = setTimeout(apply, 100);
    const t2 = setTimeout(apply, 500);
    const t3 = setTimeout(apply, 1200);

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
    let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      homeScrollMemory.scrollTop = el.scrollTop;

      isScrollingRef.current = true;
      if (!el.classList.contains("home__content--scrolling")) {
        el.classList.add("home__content--scrolling");
      }
      if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
      scrollEndTimeout = setTimeout(() => {
        el.classList.remove("home__content--scrolling");
        scrollEndTimeout = null;
        isScrollingRef.current = false;
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

  const lastSecondaryFetchToken = useRef<string>("");
  useEffect(() => {
    if (!sourcesLoaded) return;
    const filtersReady = launchboxFilters.platforms.length > 0;
    const gateKey = `${refetchToken}:${filtersReady ? "1" : "0"}`;
    if (lastSecondaryFetchToken.current === gateKey) return;
    lastSecondaryFetchToken.current = gateKey;

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
          if (rows.length > 0) writeHomeCache(`genre:${genre}`, rows);
          return [genre, rows] as const;
        });
      })
    )
      .then((entries) => {
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
    steamUserTags,
  ]);

  const lastTagFetchKeyRef = useRef<string>("");
  useEffect(() => {
    if (!sourcesLoaded) return;
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

  const lastPlatformFetchTokenRef = useRef<number>(-1);
  useEffect(() => {
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

  const lastExtraPlatformsKeyRef = useRef<string>("");
  useEffect(() => {
    if (!sourcesLoaded) return;
    if (launchboxFilters.platforms.length === 0) return;
    const extras = launchboxFilters.platforms.filter(
      (p) => platformToSystem(p.name) === null
    );
    if (extras.length === 0) return;
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

  const [librarySourcesCache, setLibrarySourcesCache] = useState<
    Map<string, string[]>
  >(new Map());

  useEffect(() => {
    if (!sourcesLoaded || sourceIds.length === 0) return;

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

  const friendsPlayingGamesEnriched = useMemo(() => {
    if (friendsPlayingGames.length === 0) return friendsPlayingGames;
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

  const hasPersonalSignal = useMemo(
    () => library.some((g) => !g.isDeleted),
    [library]
  );

  const librarySet = useMemo(
    () => new Set(library.filter((g) => !g.isDeleted).map((g) => keyOf(g))),
    [library]
  );

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
    const playedIds = new Set(becauseYouPlayedSeeds.map((g) => g.objectId));
    const filtered = out.filter((g) => !playedIds.has(g.objectId));
    return filtered.slice(0, BECAUSE_YOU_LOVE_ROW_COUNT);
  }, [library, sessionSeed, becauseYouPlayedSeeds]);

  const becauseYouPlayedSeed = becauseYouPlayedSeeds[0] ?? null;

  const similarSeedGames = useMemo<Map<string, LibraryGame>>(() => {
    const map = new Map<string, LibraryGame>();
    for (const seed of seedAssignments.values()) {
      map.set(seed.objectId, seed);
    }
    for (const seed of becauseYouPlayedSeeds) {
      map.set(seed.objectId, seed);
    }
    for (const seed of becauseYouLoveSeeds) {
      map.set(seed.objectId, seed);
    }
    return map;
  }, [seedAssignments, becauseYouPlayedSeeds, becauseYouLoveSeeds]);

  const [similarGamesBySeed, setSimilarGamesBySeed] = useState<
    Map<string, HomeRowGame[]>
  >(new Map());

  useEffect(() => {
    if (similarSeedGames.size === 0) return;
    let cancelled = false;
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
    if (!sourcesLoaded) return;
    if (similarSeedGames.size === 0) return;
    const tagMap = steamUserTags["en"];
    if (!tagMap || Object.keys(tagMap).length === 0) return;

    let cancelled = false;

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

  const personalizeRowPool = useCallback(
    (genre: string, baseGames: HomeRowGame[]): HomeRowGame[] => {
      const similar = personalizedRowGames.get(genre);
      return similar && similar.length > 0 ? similar : baseGames;
    },
    [personalizedRowGames]
  );

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
          if (!seedSystem) continue;
          if (platformToSystem(g.platform) !== seedSystem) continue;
          if (seedGenresLower.length > 0) {
            const gs = g.genres ?? [];
            const overlap = gs.some((x) =>
              seedGenresLower.includes(x.toLowerCase())
            );
            if (!overlap && gs.length > 0) continue;
          }
        } else {
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
        if (matches.length >= 16) break;
      }

      if (matches.length > 0) {
        out.set(seed.objectId, matches);
      }
    }

    return out;
  }, [similarSeedGames, classicsFallbackPool, libraryGameGenres]);

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

  const recentlyPlayedGames = useMemo(() => {
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

  const browseClassicsPool = classicsFallbackPool;

  const classicsByPlatformAndGenre = useCallback(
    (system: "ps1" | "ps2" | "ps3", genre: string): HomeRowGame[] => {
      const fetched = classicsByPlatformAndGenreFetched.get(
        `${system}:${genre}`
      );
      if (fetched && fetched.length > 0) return fetched;
      const seenIds = new Set<string>();
      const out: HomeRowGame[] = [];
      const wantedGenre = genre.toLowerCase();
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
      if (system === "ps1") {
        for (const g of crossSourceClassicsByPlatform.ps1) consider(g);
      } else if (system === "ps2") {
        for (const g of crossSourceClassicsByPlatform.ps2) consider(g);
      } else if (system === "ps3") {
        for (const g of crossSourceClassicsByPlatform.ps3) consider(g);
      }
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

  const { d, randomPicks, randomPicksPool, extraPlatformRows } = useMemo(() => {
    const globallySeen = new Set<string>();
    for (const g of weeklyGames.slice(0, 3)) globallySeen.add(keyOf(g));
    for (const g of classicsGames.slice(0, 3)) globallySeen.add(keyOf(g));
    for (const g of hotGames.slice(0, 3)) globallySeen.add(keyOf(g));
    for (const g of topReviewedGames.slice(0, 3)) globallySeen.add(keyOf(g));
    for (const g of recentlyAddedGames.slice(0, 3)) globallySeen.add(keyOf(g));

    type SliceOpts = {
      rowKey: string;
      tier: number;
      excludeLibrary?: boolean;
      dedup?: boolean;
      shuffle?: boolean;
      recordSeenAnyway?: boolean;
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

      let pool = filter(games, false, false);

      if (pool.length < POOL_RELAX_THRESHOLD && excludeLibrary) {
        pool = filter(games, true, false);
      }

      if (pool.length === 0 && games.length > 0) {
        const unseen = games.filter(
          (g) => !excludeLibrary || !librarySet.has(keyOf(g))
        );
        pool = [
          ...unseen.filter((g) => !globallySeen.has(keyOf(g))),
          ...unseen.filter((g) => globallySeen.has(keyOf(g))),
        ];
      }

      if (pool.length === 0 && fallbackPool.length > 0) {
        const usable = fallbackPool.filter((g) => {
          const k = keyOf(g);
          if (dedup && globallySeen.has(k)) return false;
          if (excludeLibrary && librarySet.has(k)) return false;
          return true;
        });
        pool = usable;
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

      const picked = shuffle
        ? pickNDiverse(pool, MAX_ROW_GAMES, hashRowKey(rowKey, sessionSeed))
        : pool.slice(0, MAX_ROW_GAMES);

      if (dedup || recordSeenAnyway) {
        for (const g of picked) globallySeen.add(keyOf(g));
      }

      return enrichSources(picked);
    };

    const personal = (games: HomeRowGame[]) =>
      enrichSources(games.slice(0, MAX_ROW_GAMES));

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

    const randomPicks = enrichSources(pickN(randomPicksPool, 12, surpriseSeed));

    const d = {
      hot: sliceDiscovery(hotGames, {
        rowKey: "hot",
        tier: 0,
        dedup: false,
        excludeLibrary: false,
        shuffle: false,
        recordSeenAnyway: true,
      }),
      mostPlayedHydra: sliceDiscovery(mostPlayedHydraGames, {
        rowKey: "mostPlayedHydra",
        tier: 0,
        shuffle: false,
      }),
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

      friendsPlaying: personal(friendsPlayingGamesEnriched),
      recentlyPlayed: personal(recentlyPlayedGames),
      favorites: personal(favoriteGames),
      gamesToBeat: personal(gamesToBeatGames),
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

      action: sliceDiscovery(
        personalizeRowPool("Action", genreData["Action"] ?? []),
        {
          rowKey: "g:Action",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),
      rpg: sliceDiscovery(personalizeRowPool("RPG", genreData["RPG"] ?? []), {
        rowKey: "g:RPG",
        tier: 2,
        fallbackPool: universalPool,
      }),
      adventure: sliceDiscovery(
        personalizeRowPool("Adventure", genreData["Adventure"] ?? []),
        {
          rowKey: "g:Adventure",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),
      openWorld: sliceDiscovery(tagData["openWorld"] ?? [], {
        rowKey: "t:openWorld",
        tier: 2,
        fallbackPool: universalPool,
      }),
      storyRich: sliceDiscovery(tagData["storyRich"] ?? [], {
        rowKey: "t:storyRich",
        tier: 2,
        fallbackPool: universalPool,
      }),
      strategy: sliceDiscovery(
        personalizeRowPool("Strategy", genreData["Strategy"] ?? []),
        {
          rowKey: "g:Strategy",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),
      simulation: sliceDiscovery(
        personalizeRowPool("Simulation", genreData["Simulation"] ?? []),
        {
          rowKey: "g:Simulation",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),
      indie: sliceDiscovery(
        personalizeRowPool("Indie", genreData["Indie"] ?? []),
        {
          rowKey: "g:Indie",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),
      sports: sliceDiscovery(
        personalizeRowPool("Sports", genreData["Sports"] ?? []),
        {
          rowKey: "g:Sports",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),
      racing: sliceDiscovery(
        personalizeRowPool("Racing", genreData["Racing"] ?? []),
        {
          rowKey: "g:Racing",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),
      puzzle: sliceDiscovery(
        personalizeRowPool("Puzzle", genreData["Puzzle"] ?? []),
        {
          rowKey: "g:Puzzle",
          tier: 2,
          fallbackPool: universalPool,
        }
      ),

      casual: sliceDiscovery(
        personalizeRowPool("Casual", genreData["Casual"] ?? []),
        {
          rowKey: "g:Casual",
          tier: 3,
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
          fallbackPool: universalPool,
        }
      ),
      coOp: sliceDiscovery(tagData["coOp"] ?? [], {
        rowKey: "t:coOp",
        tier: 3,
        fallbackPool: universalPool,
      }),
      horror: sliceDiscovery(
        personalizeRowPool("Horror", genreData["Horror"] ?? []),
        {
          rowKey: "g:Horror",
          tier: 3,
          fallbackPool: universalPool,
        }
      ),
      soulsLike: sliceDiscovery(tagData["soulsLike"] ?? [], {
        rowKey: "t:soulsLike",
        tier: 3,
        fallbackPool: universalPool,
      }),
      fighting: sliceDiscovery(
        personalizeRowPool("Fighting", genreData["Fighting"] ?? []),
        {
          rowKey: "g:Fighting",
          tier: 3,
          fallbackPool: universalPool,
        }
      ),
      platformers: sliceDiscovery(
        personalizeRowPool("Platformer", genreData["Platformer"] ?? []),
        {
          rowKey: "g:Platformer",
          tier: 3,
          fallbackPool: universalPool,
        }
      ),
      roguelite: sliceDiscovery(tagData["roguelite"] ?? [], {
        rowKey: "t:roguelite",
        tier: 3,
        fallbackPool: universalPool,
      }),
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
          const cross = crossSourceClassicsByPlatform.ps2;
          if (cross.length > 0) return cross;
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
      browseClassics: sliceDiscovery(browseClassicsPool, {
        rowKey: "browseClassics",
        tier: 4,
        fallbackPool: classicsFallbackPool,
      }),
      retro: sliceDiscovery(retroMixedPool, {
        rowKey: "retro",
        tier: 3,
        /* No universalPool fallback — if the merged retro pool is
         empty (both pre-2010 PC fetch AND classics fetch returned
         0), better to hide the row than fill it with modern hot
         games that defeat the row's whole concept. */
      }),

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
      ps1Fighting: sliceDiscovery(
        classicsByPlatformAndGenre("ps1", "Fighting"),
        {
          rowKey: "classics:ps1:fighting",
          tier: 4,
        }
      ),
      ps1Adventure: sliceDiscovery(
        classicsByPlatformAndGenre("ps1", "Adventure"),
        { rowKey: "classics:ps1:adventure", tier: 4 }
      ),
      ps2Action: sliceDiscovery(classicsByPlatformAndGenre("ps2", "Action"), {
        rowKey: "classics:ps2:action",
        tier: 4,
      }),
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
      ps2Adventure: sliceDiscovery(
        classicsByPlatformAndGenre("ps2", "Adventure"),
        { rowKey: "classics:ps2:adventure", tier: 4 }
      ),
      ps2Platformer: sliceDiscovery(
        classicsByPlatformAndGenre("ps2", "Platformer"),
        { rowKey: "classics:ps2:platformer", tier: 4 }
      ),
      ps2Fighting: sliceDiscovery(
        classicsByPlatformAndGenre("ps2", "Fighting"),
        {
          rowKey: "classics:ps2:fighting",
          tier: 4,
        }
      ),
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
      ps3Fighting: sliceDiscovery(
        classicsByPlatformAndGenre("ps3", "Fighting"),
        {
          rowKey: "classics:ps3:fighting",
          tier: 4,
        }
      ),
      ps3Racing: sliceDiscovery(classicsByPlatformAndGenre("ps3", "Racing"), {
        rowKey: "classics:ps3:racing",
        tier: 4,
      }),

      spotlight: sliceDiscovery(spotlightGames, {
        rowKey: `spotlight:${currentSpotlight.key}`,
        tier: 2,
        fallbackPool: universalPool,
      }),

      pixelArt: sliceDiscovery(tagData["pixelArt"] ?? [], {
        rowKey: "t:pixelArt",
        tier: 4,
        fallbackPool: universalPool,
      }),
      sciFi: sliceDiscovery(tagData["sciFi"] ?? [], {
        rowKey: "t:sciFi",
        tier: 4,
        fallbackPool: universalPool,
      }),
      fantasy: sliceDiscovery(tagData["fantasy"] ?? [], {
        rowKey: "t:fantasy",
        tier: 4,
        fallbackPool: universalPool,
      }),
      survival: sliceDiscovery(tagData["survival"] ?? [], {
        rowKey: "t:survival",
        tier: 4,
        fallbackPool: universalPool,
      }),
    };

    const extraPlatformRows: {
      platformKey: string;
      platformLabel: string;
      sliced: HomeRowGame[];
    }[] = [];
    for (const platform of launchboxFilters.platforms) {
      if (platformToSystem(platform.name) !== null) continue;
      const platformGames = extraPlatformGames[platform.key];
      if (!platformGames || platformGames.length === 0) continue;
      const sliced = sliceDiscovery(platformGames, {
        rowKey: `platform:${platform.key}`,
        tier: 2,
      });
      if (sliced.length === 0) continue;
      extraPlatformRows.push({
        platformKey: platform.key,
        platformLabel: platform.name,
        sliced,
      });
    }

    return { d, randomPicks, randomPicksPool, extraPlatformRows };
  }, [
    allSimilarBySeed,
    extraPlatformGames,
    launchboxFilters,
    becauseYouLoveSeeds,
    becauseYouPlayedSeeds,
    brandNewGames,
    browseClassicsPool,
    classicsByPlatformAndGenre,
    classicsFallbackPool,
    classicsGames,
    criticallyAcclaimedGames,
    crossSourceClassicsByPlatform,
    currentSpotlight.key,
    enrichSources,
    favoriteGames,
    friendsPlayingGamesEnriched,
    fromCollectionsGames,
    fromLibraryGames,
    gamesToBeatGames,
    genreData,
    hiddenGemsGames,
    hotGames,
    libraryClassicsPool,
    librarySet,
    mostPlayedHydraGames,
    personalizeRowPool,
    ps1Games,
    ps2Games,
    ps3Games,
    recentlyAddedGames,
    recentlyPlayedGames,
    retroMixedPool,
    sessionSeed,
    spotlightGames,
    surpriseSeed,
    tagData,
    topReviewedGames,
    universalPool,
    weeklyGames,
  ]);

  useEffect(() => {
    if (!hasPersonalSignal && visibleTier === 1) {
      setVisibleTier(2);
    }
  }, [hasPersonalSignal, visibleTier]);

  const handleScrollToTop = () => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToTag = (tagName: string) => {
    const id = lookupTagId(tagName);
    goToCatalogue("modern", id != null ? { tags: [id] } : {});
  };

  const personalizedOr = (
    _genre: string,
    fallbackKey: string
  ): React.ReactNode => t(fallbackKey);

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

  const allSpecs: OrderedRowSpec[] = [];

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

  for (const { platformKey, platformLabel, sliced } of extraPlatformRows) {
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

  if (import.meta.env.DEV && allSpecs.length < TARGET_ROW_COUNT) {
    // eslint-disable-next-line no-console
    console.debug(
      "[home] row pool below target",
      allSpecs.length,
      "<",
      TARGET_ROW_COUNT
    );
  }

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

  for (const spec of allSpecs) {
    spec.isVertical = verticalRowIds.has(spec.id);
  }

  const cardStyleFor = (
    id: string
  ): "horizontal" | "vertical" | "recently-played" => {
    if (id === "recentlyPlayed") return "recently-played";
    return verticalRowIds.has(id) ? "vertical" : "horizontal";
  };

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
    const budgetedNonAnchors = [...promoted, ...remainderNonAnchors];

    const nonAnchorsForTop = Math.max(0, TOP_WINDOW_SIZE - anchorSpecs.length);
    const topNonAnchors = budgetedNonAnchors.slice(0, nonAnchorsForTop);
    const restNonAnchors = budgetedNonAnchors.slice(nonAnchorsForTop);
    const topWindow = shuffleWithSeparation(
      [...anchorSpecs, ...topNonAnchors],
      sessionSeed ^ 0xb
    );
    const shuffledRest = shuffleWithSeparation(
      restNonAnchors,
      sessionSeed ^ 0xc
    );
    return [...topWindow, ...shuffledRest]
      .slice(0, TARGET_ROW_COUNT)
      .map((s) => s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSignature, sessionSeed]);

  const specsById = new Map(allSpecs.map((s) => [s.id, s]));
  const orderedRows = cachedRowOrder
    .map((id) => specsById.get(id))
    .filter((s): s is OrderedRowSpec => s != null);

  const tierEnd =
    visibleTier >= MAX_TIER
      ? orderedRows.length
      : TIER_START_INDICES[visibleTier + 1];
  const renderedRows = orderedRows.slice(0, tierEnd);

  const heroCandidates = useMemo<HeroCandidate[]>(() => {
    const out: HeroCandidate[] = [];
    const used = new Set<string>();
    const claim = (g: HomeRowGame) => {
      const k = `${g.shop}:${g.objectId}`;
      if (used.has(k)) return false;
      used.add(k);
      return true;
    };

    const hasPcAssets = (g: HomeRowGame) =>
      !!g.logoImageUrl && !!(g.libraryHeroImageUrl ?? g.libraryImageUrl);

    const hasDisplayableAssets = (g: HomeRowGame) => {
      if (g.shop === "launchbox") {
        return !!(g.coverImageUrl ?? g.libraryImageUrl);
      }
      return hasPcAssets(g);
    };

    for (const g of hotGames) {
      if (!hasPcAssets(g)) continue;
      if (!claim(g)) continue;
      out.push({ kind: "hot-now", game: g });
      break;
    }

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
            (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
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

    if (hasPersonalSignal) {
      const libClassics = library.filter(
        (g) => !g.isDeleted && g.shop === "launchbox"
      );
      if (libClassics.length > 0) {
        const idx = (sessionSeed ^ 0x5a5a) % libClassics.length;
        for (let i = 0; i < libClassics.length; i++) {
          const cand = libClassics[(idx + i) % libClassics.length];
          const row = libraryGameToRowGame(cand);
          if (!claim(row)) continue;
          out.push({ kind: "good-old-days", game: row });
          break;
        }
      }
    }

    if (hasPersonalSignal) {
      const libClassics = library.filter(
        (g) => !g.isDeleted && g.shop === "launchbox"
      );
      if (libClassics.length >= 2) {
        const idx = (sessionSeed ^ 0xa5a5) % libClassics.length;
        for (let i = 0; i < libClassics.length; i++) {
          const cand = libClassics[(idx + i) % libClassics.length];
          const row = libraryGameToRowGame(cand);
          if (!claim(row)) continue;
          out.push({ kind: "hot-now-classics", game: row });
          break;
        }
      }
    }

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
            new Date(b.lastTimePlayed as string | Date).getTime() -
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

    if (hasPersonalSignal && becauseYouPlayedSeed) {
      const similar = allSimilarBySeed.get(becauseYouPlayedSeed.objectId) ?? [];
      for (const g of similar) {
        if (!hasDisplayableAssets(g)) continue;
        if (!claim(g)) continue;
        out.push({
          kind: "because-you-played",
          game: g,
          seedGameTitle: becauseYouPlayedSeed.title,
          seedGameLogoUrl: becauseYouPlayedSeed.logoImageUrl ?? null,
        });
        break;
      }
    }

    return out;
  }, [
    hotGames,
    hasPersonalSignal,
    library,
    weeklyGames,
    recentlyAddedGames,
    topReviewedGames,
    randomPicksPool,
    sessionSeed,
    becauseYouPlayedSeed,
    allSimilarBySeed,
  ]);

  return (
    <HomeHydrationContext.Provider value={isHydrating}>
      <HomeFriendsProvider value={friendsByGameKey}>
        <HomeScrollStateContext.Provider value={homeScrollState}>
          <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
            <section ref={contentRef} className="home__content">
              <Hero
                candidates={heroCandidates}
                sessionSeed={sessionSeed}
                popularityRanking={hotGames}
                discoveryPicks={[
                  ...hotGames.slice(0, 5),
                  ...topReviewedGames.slice(0, 5),
                  ...recentlyAddedGames.slice(0, 5),
                ]}
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
                const animDelay = isFirstHomeMount ? i * 60 : 0;
                const rendered = spec.render(animDelay);
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
