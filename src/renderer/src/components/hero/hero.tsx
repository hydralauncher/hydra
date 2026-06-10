import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameShop, TrendingGame } from "@types";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import {
  StarFillIcon,
  BookmarkFillIcon,
  ClockIcon,
  DownloadIcon,
  FlameIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import {
  buildGameDetailsPath,
  platformToSystem,
  SYSTEM_TO_BINARY,
} from "@renderer/helpers";
import { useAppSelector } from "@renderer/hooks";
import { levelDBService } from "@renderer/services/leveldb.service";
import { EMULATOR_ICONS } from "@renderer/pages/settings/emulation/emulator-icons";
import { Badge } from "../badge/badge";

import nesControllerSvg from "@renderer/assets/icons/nes-controller.svg?url";

import "./hero.scss";

const ROTATION_INTERVAL_MS = 9_000;
const RESUME_DELAY_MS = 500;
const MAX_GAME_SLIDES = 5;
const HERO_CACHE_KEY = "home:hero:session:v13";
const KNOWN_REASON_KINDS = new Set<string>([
  "hot-now",
  "recently-played",
  "most-downloaded-this-week",
  "random-pick",
  "from-library",
  "good-old-days",
  "hot-now-classics",
  "trophy-hunter",
  "because-you-played",
]);
const HERO_CACHE_SUBLEVEL = "homeRows";
const DRAG_CLICK_GUARD_PX = 5;
const DRAG_SNAP_THRESHOLD_PX = 70;

interface HeroPickGame {
  objectId: string;
  shop: GameShop;
  title: string;
  libraryHeroImageUrl?: string | null;
  libraryImageUrl?: string | null;
  coverImageUrl?: string | null;
  logoImageUrl?: string | null;
  platform?: string | null;
  description?: string | null;
}

type SlideReason =
  | { kind: "hot-now" }
  | { kind: "recently-played"; gameTitle: string; hours: number }
  | { kind: "most-downloaded-this-week" }
  | { kind: "random-pick" }
  | { kind: "from-library"; gameTitle: string }
  | { kind: "good-old-days" }
  | { kind: "hot-now-classics" }
  | { kind: "trophy-hunter"; gameTitle: string }
  | {
      kind: "because-you-played";
      seedGameTitle: string;
      seedGameLogoUrl?: string | null;
    };

export type HeroCandidateKind =
  | "hot-now"
  | "recently-played"
  | "most-downloaded-this-week"
  | "random-pick"
  | "from-library"
  | "good-old-days"
  | "hot-now-classics"
  | "trophy-hunter"
  | "because-you-played";

export interface HeroCandidate {
  kind: HeroCandidateKind;
  game: HeroPickGame;
  hoursThisWeek?: number;
  seedGameTitle?: string;
  seedGameLogoUrl?: string | null;
  becauseOfTitle?: string;
}

interface HeroProps {
  candidates?: HeroCandidate[];
  discoveryPicks?: HeroPickGame[];
  hasLibrarySignal?: boolean;
  sessionSeed?: number;
  popularityRanking?: HeroPickGame[];
}

const PLATFORM_LABELS: Record<string, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
};

interface HeroSlideBase {
  key: string;
  objectId: string;
  shop: GameShop;
  navigateTo: string;
  title: string;
  platformLabel: string | null;
  emulatorIcon: string | null;
  reason: SlideReason;
  sourceAssets: {
    libraryHeroImageUrl?: string | null;
    libraryImageUrl?: string | null;
    coverImageUrl?: string | null;
    logoImageUrl?: string | null;
    description?: string | null;
  };
}

interface HeroSlidePc extends HeroSlideBase {
  variant: "pc";
  description: string | null;
  libraryHeroImageUrl: string;
  logoImageUrl: string;
}

interface HeroSlideClassics extends HeroSlideBase {
  variant: "classics";
  coverImageUrl: string;
}

type HeroSlide = HeroSlidePc | HeroSlideClassics;

interface CachedSlide {
  game: HeroPickGame;
  reason: SlideReason;
}

interface SessionCacheEntry {
  sessionSeed: number;
  generatedAt: number;
  slides: CachedSlide[];
}

function reasonChip(reason: SlideReason): {
  icon: React.ReactNode;
  primary: string;
  secondary: string;
} {
  const kind = reason?.kind as SlideReason["kind"] | undefined;
  if (!kind || !KNOWN_REASON_KINDS.has(kind)) {
    return {
      icon: <StarFillIcon size={14} />,
      primary: "Hot Now",
      secondary: "Trending on Hydra",
    };
  }
  switch (reason.kind) {
    case "hot-now":
      return {
        icon: <FlameIcon size={14} />,
        primary: "Hot Now",
        secondary: "Most popular right now",
      };
    case "recently-played": {
      const hours = typeof reason.hours === "number" ? reason.hours : 0;
      const formatted =
        hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
      return {
        icon: <ClockIcon size={14} />,
        primary: `${formatted} this week`,
        secondary: reason.gameTitle ?? "Recently played",
      };
    }
    case "most-downloaded-this-week":
      return {
        icon: <DownloadIcon size={14} />,
        primary: "Most Downloaded This Week",
        secondary: "Trending on Hydra",
      };
    case "random-pick":
      return {
        icon: <StarFillIcon size={14} />,
        primary: "Pick for you",
        secondary: "Hidden gem you might like",
      };
    case "from-library":
      return {
        icon: <BookmarkFillIcon size={14} />,
        primary: "From your library",
        secondary: reason.gameTitle ?? "Library pick",
      };
    case "good-old-days":
      return {
        icon: (
          <img
            src={nesControllerSvg}
            alt=""
            aria-hidden="true"
            className="hero__reason-img hero__reason-img--mono"
          />
        ),
        primary: "Good Old Days",
        secondary: "From your classics shelf",
      };
    case "hot-now-classics":
      return {
        icon: (
          <img
            src={nesControllerSvg}
            alt=""
            aria-hidden="true"
            className="hero__reason-img hero__reason-img--mono"
          />
        ),
        primary: "Hot Now on Classics",
        secondary: "Classics surfacing again",
      };
    case "trophy-hunter":
      return {
        icon: <TrophyIcon size={14} />,
        primary: "Trophy Hunter",
        secondary: reason.gameTitle ?? "Recent unlock",
      };
    case "because-you-played": {
      const seedTitle =
        typeof reason.seedGameTitle === "string" && reason.seedGameTitle
          ? reason.seedGameTitle
          : "a game";
      return {
        icon: reason.seedGameLogoUrl ? (
          <img
            src={reason.seedGameLogoUrl}
            alt=""
            aria-hidden="true"
            className="hero__reason-img hero__reason-img--logo"
          />
        ) : (
          <span className="hero__reason-letter" aria-hidden="true">
            {seedTitle.charAt(0).toUpperCase()}
          </span>
        ),
        primary: `Because you played ${seedTitle}`,
        secondary: "Sharing tags with that game",
      };
    }
  }
}

function buildSlide(
  game: HeroPickGame,
  prefix: string,
  classicsUseHeroLayout: boolean,
  reason: SlideReason
): HeroSlide | null {
  const sys = platformToSystem(game.platform);
  const platformLabel = sys ? (PLATFORM_LABELS[sys] ?? game.platform) : null;
  const emulatorIcon =
    sys && SYSTEM_TO_BINARY[sys]
      ? (EMULATOR_ICONS[SYSTEM_TO_BINARY[sys]] ?? null)
      : null;

  const isClassics = game.shop === "launchbox";
  const navigateTo = buildGameDetailsPath({
    objectId: game.objectId,
    shop: game.shop,
    title: game.title,
  });

  const sourceAssets = {
    libraryHeroImageUrl: game.libraryHeroImageUrl ?? null,
    libraryImageUrl: game.libraryImageUrl ?? null,
    coverImageUrl: game.coverImageUrl ?? null,
    logoImageUrl: game.logoImageUrl ?? null,
    description: game.description ?? null,
  };

  if (isClassics) {
    const canPcLayout = !!game.libraryHeroImageUrl && !!game.logoImageUrl;
    const cover = game.coverImageUrl ?? game.libraryImageUrl;
    const canBoxArt = !!cover;
    const useBoxArt =
      (!classicsUseHeroLayout && canBoxArt) ||
      (classicsUseHeroLayout && !canPcLayout && canBoxArt);
    if (useBoxArt) {
      return {
        variant: "classics",
        key: `${prefix}:${game.shop}:${game.objectId}`,
        objectId: game.objectId,
        shop: game.shop,
        navigateTo,
        title: game.title,
        platformLabel,
        emulatorIcon,
        reason,
        sourceAssets,
        coverImageUrl: cover as string,
      };
    }
    /* Fall through to PC hero layout — either the user opted in
       AND we have the assets, OR the box-art assets are missing and
       PC assets ARE available as fallback. */
  }

  const hero = game.libraryHeroImageUrl ?? game.libraryImageUrl;
  const logo = game.logoImageUrl;
  if (!hero || !logo) return null;
  return {
    variant: "pc",
    key: `${prefix}:${game.shop}:${game.objectId}`,
    objectId: game.objectId,
    shop: game.shop,
    navigateTo,
    title: game.title,
    platformLabel,
    emulatorIcon,
    reason,
    sourceAssets,
    description: game.description ?? null,
    libraryHeroImageUrl: hero,
    logoImageUrl: logo,
  };
}

function renderSlide(
  slide: HeroSlide,
  domKey: string,
  fetchedDescription: string | undefined,
  onClick: (e: React.MouseEvent) => void
) {
  const chip = reasonChip(slide.reason);

  const tooltipTitle =
    slide.reason.kind === "recently-played"
      ? `${slide.reason.hours.toFixed(1)} hours this week`
      : undefined;

  const reasonBadge = (
    <div className="hero__reason" title={tooltipTitle}>
      <Badge>
        <span className="hero__reason-icon" aria-hidden="true">
          {chip.icon}
        </span>
        <span className="hero__reason-text">
          <span className="hero__reason-primary">{chip.primary}</span>
          <span className="hero__reason-secondary">{chip.secondary}</span>
        </span>
      </Badge>
    </div>
  );

  if (slide.variant === "classics") {
    return (
      <button
        type="button"
        key={domKey}
        className="hero__slide hero__slide--classics"
        onClick={onClick}
        onDragStart={(e) => e.preventDefault()}
      >
        <img
          src={slide.coverImageUrl}
          alt=""
          aria-hidden="true"
          className="hero__classics-backdrop"
          loading="eager"
          decoding="async"
        />
        <div className="hero__classics-overlay" />

        {reasonBadge}

        <div className="hero__classics-content">
          <div className="hero__classics-cover">
            <img
              src={slide.coverImageUrl}
              alt={slide.title}
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="hero__classics-meta">
            <h2 className="hero__classics-title">{slide.title}</h2>
            <div className="hero__classics-chips">
              {slide.platformLabel && (
                <span className="hero__classics-chip">
                  {slide.platformLabel}
                </span>
              )}
              {slide.emulatorIcon && (
                <span className="hero__classics-chip hero__classics-chip--icon">
                  <img src={slide.emulatorIcon} alt="" />
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      key={domKey}
      className="hero__slide"
      onClick={onClick}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="hero__backdrop">
        <img
          src={slide.libraryHeroImageUrl}
          alt=""
          aria-hidden="true"
          className="hero__media"
          loading="eager"
          decoding="async"
        />

        {reasonBadge}

        <div className="hero__content">
          {/* Platform label was being drawn for classic games rendered
              in the PC hero layout (logo + libraryHeroImageUrl) — it
              floated awkwardly above the logo because there's no
              visual frame to anchor it to (unlike the classics box-art
              layout, which has its own metadata strip). The reason
              chip in the top-right already conveys the classics
              context ("Hot Now on Classics", "Good Old Days", etc.),
              so the duplicate platform badge here was just noise.
              Suppress it for classics PC-layout slides — keep it for
              PC games that genuinely carry one (none today, but the
              field exists in PLATFORM_LABELS for future use). */}
          {slide.platformLabel && slide.shop !== "launchbox" && (
            <span className="hero__platform-badge">{slide.platformLabel}</span>
          )}

          <img
            src={slide.logoImageUrl}
            alt={slide.title}
            loading="eager"
            decoding="async"
            className="hero__logo"
          />

          {(slide.description || fetchedDescription) && (
            <p className="hero__description">
              {slide.description || fetchedDescription}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

export function Hero({
  candidates = [],
  discoveryPicks = [],
  hasLibrarySignal = false,
  sessionSeed = 0,
  popularityRanking = [],
}: HeroProps) {
  const [featured, setFeatured] = useState<TrendingGame[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [trackIndex, setTrackIndex] = useState(1);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [paused, setPaused] = useState(false);
  const [progressTick, setProgressTick] = useState(0);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [cachedEntry, setCachedEntry] = useState<SessionCacheEntry | null>(
    null
  );
  const [cacheChecked, setCacheChecked] = useState(false);

  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const classicsUseHeroLayout = userPreferences?.classicsUseHeroLayout ?? false;
  const disableSlideAnimations =
    userPreferences?.disableHomeSlideAnimations ?? false;

  useEffect(() => {
    setIsLoading(true);
    const language = i18n.language.split("-")[0];

    window.electron.hydraApi
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((result) => setFeatured(result))
      .catch(() => setFeatured([]))
      .finally(() => setIsLoading(false));
  }, [i18n.language]);

  useEffect(() => {
    let cancelled = false;
    levelDBService
      .get(HERO_CACHE_KEY, HERO_CACHE_SUBLEVEL, "json")
      .then((value) => {
        if (cancelled) return;
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as SessionCacheEntry).generatedAt !== "number" ||
          typeof (value as SessionCacheEntry).sessionSeed !== "number" ||
          !Array.isArray((value as SessionCacheEntry).slides)
        )
          return;
        const entry = value as SessionCacheEntry;
        const allKindsKnown = entry.slides.every(
          (s) =>
            !!s.reason &&
            typeof s.reason.kind === "string" &&
            KNOWN_REASON_KINDS.has(s.reason.kind)
        );
        if (!allKindsKnown) return;
        setCachedEntry(entry);
      })
      .catch(() => {
        /* No cache yet — first run. */
      })
      .finally(() => {
        if (!cancelled) setCacheChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isCacheFresh =
    cachedEntry !== null && cachedEntry.sessionSeed === sessionSeed;

  const slides = useMemo<HeroSlide[]>(() => {
    if (!cacheChecked) return [];

    if (isCacheFresh && cachedEntry) {
      const out: HeroSlide[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < cachedEntry.slides.length; i++) {
        const { game, reason } = cachedEntry.slides[i];
        const id = `${game.shop}:${game.objectId}`;
        if (seen.has(id)) continue;
        const built = buildSlide(
          game,
          `cached-${i}`,
          classicsUseHeroLayout,
          reason
        );
        if (!built) continue;
        seen.add(id);
        out.push(built);
      }
      return out;
    }

    let s = sessionSeed >>> 0 || 1;
    const rng = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shuffleInPlace = <T,>(arr: T[]) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    const featuredArr = featured ?? [];
    const candidateByKind = new Map<HeroCandidateKind, HeroCandidate>();
    for (const c of candidates) {
      if (!candidateByKind.has(c.kind)) candidateByKind.set(c.kind, c);
    }

    const resolveHotNow = (): HeroPickGame | null => {
      const fromHome = candidateByKind.get("hot-now");
      if (fromHome) return fromHome.game;
      if (featuredArr.length === 0 && popularityRanking.length === 0)
        return null;
      const rankMap = new Map<string, number>();
      popularityRanking.forEach((g, i) => {
        rankMap.set(`${g.shop}:${g.objectId}`, i);
      });
      let bestIdx = -1;
      let bestRank = Number.POSITIVE_INFINITY;
      for (let i = 0; i < featuredArr.length; i++) {
        const f = featuredArr[i] as HeroPickGame;
        const r = rankMap.get(`${f.shop}:${f.objectId}`);
        if (r !== undefined && r < bestRank) {
          bestRank = r;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) return featuredArr[bestIdx] as HeroPickGame;
      if (featuredArr.length > 0) return featuredArr[0] as HeroPickGame;
      if (popularityRanking.length > 0) return popularityRanking[0];
      return null;
    };

    const seen = new Set<string>();
    const tryBuild = (
      game: HeroPickGame,
      reason: SlideReason,
      keyPrefix: string
    ): HeroSlide | null => {
      const id = `${game.shop}:${game.objectId}`;
      if (seen.has(id)) return null;
      const built = buildSlide(game, keyPrefix, classicsUseHeroLayout, reason);
      if (!built) return null;
      seen.add(id);
      return built;
    };

    const reasonForCandidate = (c: HeroCandidate): SlideReason => {
      switch (c.kind) {
        case "hot-now":
          return { kind: "hot-now" };
        case "recently-played":
          return {
            kind: "recently-played",
            gameTitle: c.becauseOfTitle ?? c.game.title,
            hours: c.hoursThisWeek ?? 0,
          };
        case "most-downloaded-this-week":
          return { kind: "most-downloaded-this-week" };
        case "random-pick":
          return { kind: "random-pick" };
        case "from-library":
          return {
            kind: "from-library",
            gameTitle: c.becauseOfTitle ?? c.game.title,
          };
        case "good-old-days":
          return { kind: "good-old-days" };
        case "hot-now-classics":
          return { kind: "hot-now-classics" };
        case "trophy-hunter":
          return {
            kind: "trophy-hunter",
            gameTitle: c.becauseOfTitle ?? c.game.title,
          };
        case "because-you-played":
          return {
            kind: "because-you-played",
            seedGameTitle: c.seedGameTitle ?? "a game",
            seedGameLogoUrl: c.seedGameLogoUrl ?? null,
          };
      }
    };

    const accepted: HeroSlide[] = [];

    const allKinds: HeroCandidateKind[] = [
      "hot-now",
      "recently-played",
      "most-downloaded-this-week",
      "random-pick",
      "from-library",
      "good-old-days",
      "hot-now-classics",
      "trophy-hunter",
      "because-you-played",
    ];
    shuffleInPlace(allKinds);

    for (const kind of allKinds) {
      if (accepted.length >= MAX_GAME_SLIDES) break;
      if (kind === "hot-now") {
        const hotGame = resolveHotNow();
        if (!hotGame) continue;
        const built = tryBuild(hotGame, { kind: "hot-now" }, "kind-hot-now");
        if (built) accepted.push(built);
        continue;
      }
      const candidate = candidateByKind.get(kind);
      if (!candidate) continue;
      const built = tryBuild(
        candidate.game,
        reasonForCandidate(candidate),
        `kind-${kind}`
      );
      if (built) accepted.push(built);
    }

    for (let i = 0; accepted.length < 2 && i < discoveryPicks.length; i++) {
      const built = tryBuild(
        discoveryPicks[i],
        { kind: "hot-now" },
        `disc-${i}`
      );
      if (built) accepted.push(built);
    }

    shuffleInPlace(accepted);

    return accepted;
  }, [
    featured,
    candidates,
    sessionSeed,
    discoveryPicks,
    popularityRanking,
    classicsUseHeroLayout,
    cachedEntry,
    cacheChecked,
    isCacheFresh,
  ]);

  useEffect(() => {
    if (!cacheChecked || isCacheFresh) return;
    if (slides.length === 0) return;

    const kinds = new Set(slides.map((s) => s.reason.kind));
    const personalisedKinds: SlideReason["kind"][] = [
      "recently-played",
      "from-library",
      "good-old-days",
      "hot-now-classics",
      "trophy-hunter",
      "because-you-played",
    ];
    const hasPersonalised = personalisedKinds.some((k) => kinds.has(k));

    const validForUser =
      slides.length >= 2 && (!hasLibrarySignal || hasPersonalised);
    if (!validForUser) return;

    const cachedSlides: CachedSlide[] = slides.map((s) => {
      const reason = s.reason;
      const src = s.sourceAssets;
      const base: HeroPickGame = {
        objectId: s.objectId,
        shop: s.shop,
        title: s.title,
        platform: s.platformLabel ?? undefined,
        libraryHeroImageUrl: src.libraryHeroImageUrl ?? undefined,
        libraryImageUrl: src.libraryImageUrl ?? undefined,
        coverImageUrl: src.coverImageUrl ?? undefined,
        logoImageUrl: src.logoImageUrl ?? undefined,
        description:
          (s.variant === "pc" && (s.description ?? descriptions[s.key])) ||
          src.description ||
          null,
      };
      return { game: base, reason };
    });

    const entry: SessionCacheEntry = {
      sessionSeed,
      generatedAt: Date.now(),
      slides: cachedSlides,
    };
    levelDBService
      .put(HERO_CACHE_KEY, entry, HERO_CACHE_SUBLEVEL, "json")
      .catch(() => {});
    setCachedEntry(entry);
  }, [
    slides,
    cacheChecked,
    isCacheFresh,
    hasLibrarySignal,
    descriptions,
    sessionSeed,
  ]);

  const slidesLen = slides.length;

  const displayIndex = useMemo(() => {
    if (slidesLen === 0) return 0;
    return (((trackIndex - 1) % slidesLen) + slidesLen) % slidesLen;
  }, [trackIndex, slidesLen]);

  useEffect(() => {
    const language = i18n.language.split("-")[0];
    const missing = slides.filter(
      (s) =>
        s.variant === "pc" &&
        !s.description &&
        descriptions[s.key] === undefined
    );
    if (missing.length === 0) return;

    let cancelled = false;
    missing.forEach((slide) => {
      window.electron
        .getGameShopDetails(slide.objectId, slide.shop, language)
        .then((details) => {
          if (cancelled || !details) return;
          const text =
            (details.short_description as string | undefined)?.trim() ||
            (details.about_the_game as string | undefined)
              ?.replace(/<[^>]*>/g, "")
              .trim() ||
            "";
          setDescriptions((prev) => ({ ...prev, [slide.key]: text }));
        })
        .catch(() => {
          setDescriptions((prev) => ({ ...prev, [slide.key]: "" }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [slides, descriptions, i18n.language]);

  useEffect(() => {
    if (slidesLen === 0) return;
    if (trackIndex < 0 || trackIndex > slidesLen + 1) {
      setTrackIndex(1);
      setTransitionEnabled(false);
      requestAnimationFrame(() => setTransitionEnabled(true));
    }
  }, [slidesLen, trackIndex]);

  useEffect(() => {
    setProgressTick((t) => t + 1);
  }, [displayIndex]);

  const slideStartRef = useRef<number>(Date.now());
  const totalPausedRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAdvanceTimeout = () => {
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
  };

  const scheduleAdvance = useCallback(() => {
    clearAdvanceTimeout();
    if (disableSlideAnimations) return;
    if (slidesLen <= 1) return;
    const elapsed = Date.now() - slideStartRef.current - totalPausedRef.current;
    const remaining = Math.max(0, ROTATION_INTERVAL_MS - elapsed);
    advanceTimeoutRef.current = setTimeout(() => {
      setTrackIndex((t) => t + 1);
    }, remaining);
  }, [slidesLen, disableSlideAnimations]);

  useEffect(() => {
    slideStartRef.current = Date.now();
    totalPausedRef.current = 0;
    pauseStartRef.current = null;
    if (!paused) scheduleAdvance();
    return clearAdvanceTimeout;
  }, [displayIndex, scheduleAdvance, paused]);

  const handleTrackTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== "transform") return;
      if (trackIndex === 0) {
        setTransitionEnabled(false);
        setTrackIndex(slidesLen);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setTransitionEnabled(true));
        });
      } else if (trackIndex === slidesLen + 1) {
        setTransitionEnabled(false);
        setTrackIndex(1);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setTransitionEnabled(true));
        });
      }
    },
    [trackIndex, slidesLen]
  );

  const scheduleResume = useCallback(() => {
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    resumeTimeoutRef.current = setTimeout(() => {
      if (pauseStartRef.current != null) {
        totalPausedRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }
      setPaused(false);
      scheduleAdvance();
      resumeTimeoutRef.current = null;
    }, RESUME_DELAY_MS);
  }, [scheduleAdvance]);

  const handleMouseEnter = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
    setPaused(true);
    if (pauseStartRef.current == null) {
      pauseStartRef.current = Date.now();
    }
    clearAdvanceTimeout();
  }, []);

  const isMouseDownRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragDeltaRef = useRef(0);
  const dragSeedRef = useRef(0);
  const dragStartIndexRef = useRef(1);
  const wasDraggedRef = useRef(false);
  const heroWidthRef = useRef(0);
  const dragRafRef = useRef<number | null>(null);
  const snapRafRef = useRef<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (slidesLen <= 1) return;

      if (snapRafRef.current != null) {
        cancelAnimationFrame(snapRafRef.current);
        snapRafRef.current = null;
      }

      const width = heroRef.current?.clientWidth ?? 0;
      heroWidthRef.current = width;

      let seed = 0;
      const track = trackRef.current;
      if (track && width > 0) {
        const transform = getComputedStyle(track).transform;
        if (transform && transform !== "none") {
          seed = new DOMMatrixReadOnly(transform).m41 + trackIndex * width;
        }
      }

      isMouseDownRef.current = true;
      dragStartXRef.current = e.clientX;
      dragSeedRef.current = seed;
      dragStartIndexRef.current = trackIndex;
      dragDeltaRef.current = 0;
      wasDraggedRef.current = false;
      setIsDragging(true);
      setDragOffset(seed);
      handleMouseEnter();
    },
    [slidesLen, trackIndex, handleMouseEnter]
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      if (!isMouseDownRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      dragDeltaRef.current = delta;
      if (Math.abs(delta) > DRAG_CLICK_GUARD_PX) {
        wasDraggedRef.current = true;
      }
      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          let next = dragSeedRef.current + dragDeltaRef.current;
          const width = heroWidthRef.current;
          if (width > 0) {
            const idx = dragStartIndexRef.current;
            const min = (idx - (slidesLen + 1)) * width;
            const max = idx * width;
            next = Math.max(min, Math.min(max, next));
          }
          setDragOffset(next);
        });
      }
    };

    const onUp = (e: MouseEvent) => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      const delta = dragDeltaRef.current;
      dragDeltaRef.current = 0;
      dragSeedRef.current = 0;

      setIsDragging(false);

      const rect = heroRef.current?.getBoundingClientRect();
      const pointerLeft =
        !rect ||
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
      if (pointerLeft) scheduleResume();

      snapRafRef.current = requestAnimationFrame(() => {
        snapRafRef.current = requestAnimationFrame(() => {
          snapRafRef.current = null;
          setDragOffset(0);
          const width = heroWidthRef.current;
          if (
            slidesLen > 1 &&
            width > 0 &&
            Math.abs(delta) > DRAG_SNAP_THRESHOLD_PX
          ) {
            const direction = delta < 0 ? 1 : -1;
            const steps = Math.max(1, Math.round(Math.abs(delta) / width));
            setTrackIndex((t) =>
              Math.max(0, Math.min(slidesLen + 1, t + direction * steps))
            );
          }
        });
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, [isDragging, slidesLen, scheduleResume]);

  const handleMouseLeave = useCallback(() => {
    if (isMouseDownRef.current) return;
    scheduleResume();
  }, [scheduleResume]);

  useEffect(
    () => () => {
      clearAdvanceTimeout();
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    },
    []
  );

  if (
    (isLoading && !featured && !cachedEntry) ||
    (!cacheChecked && slides.length === 0)
  ) {
    return <Skeleton className="hero" />;
  }

  if (slides.length === 0) return null;

  const handleSlideClick = (e: React.MouseEvent, slide: HeroSlide) => {
    if (wasDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      wasDraggedRef.current = false;
      return;
    }
    navigate(slide.navigateTo);
  };

  const showClones = slidesLen > 1;
  const lastSlide = slides[slidesLen - 1];
  const firstSlide = slides[0];

  const dragFraction =
    isDragging && heroWidthRef.current > 0
      ? Math.max(-1, Math.min(1, dragOffset / heroWidthRef.current))
      : 0;

  return (
    /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
    <div
      ref={heroRef}
      className={`hero hero--carousel${paused ? " hero--paused" : ""}${
        isDragging ? " hero--dragging" : ""
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleDragStart}
      style={
        {
          "--hero-interval": `${ROTATION_INTERVAL_MS}ms`,
        } as React.CSSProperties
      }
    >
      <div
        ref={trackRef}
        className={`hero__track${
          transitionEnabled ? "" : " hero__track--no-transition"
        }`}
        style={{
          transform: `translate3d(calc(-${trackIndex * 100}% + ${dragOffset}px), 0, 0)`,
        }}
        onTransitionEnd={handleTrackTransitionEnd}
      >
        {showClones &&
          renderSlide(
            lastSlide,
            `clone-last:${lastSlide.key}`,
            descriptions[lastSlide.key],
            (e) => handleSlideClick(e, lastSlide)
          )}
        {slides.map((slide) =>
          renderSlide(slide, slide.key, descriptions[slide.key], (e) =>
            handleSlideClick(e, slide)
          )
        )}
        {showClones &&
          renderSlide(
            firstSlide,
            `clone-first:${firstSlide.key}`,
            descriptions[firstSlide.key],
            (e) => handleSlideClick(e, firstSlide)
          )}
      </div>

      {/* Tabs — minimal thin progress bars at the bottom-right. One
          rectangle per slide. The active tab's fill is driven by the
          auto-rotate animation while the slide is on screen; when
          the user drags + releases past the snap threshold, the
          fill animates from its paused position to fully-filled
          over the same 0.6s the carousel uses to slide the new card
          into place. Subtle parallax shift on the row tracks the
          drag direction without otherwise reacting to the motion. */}
      {slides.length > 1 && (
        <div
          className="hero__tabs"
          style={
            isDragging
              ? ({
                  transform: `translateX(${dragFraction * -10}px)`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {slides.map((slide, i) => {
            const state =
              i < displayIndex
                ? "past"
                : i > displayIndex
                  ? "future"
                  : "active";
            return (
              <button
                type="button"
                key={slide.key}
                className={`hero__tab hero__tab--${state}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setTrackIndex(i + 1);
                }}
                aria-label={`Go to slide ${i + 1}`}
              >
                <span
                  key={
                    state === "active"
                      ? `active:${displayIndex}:${progressTick}`
                      : `still:${i}`
                  }
                  className={`hero__tab-fill hero__tab-fill--${state}`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
