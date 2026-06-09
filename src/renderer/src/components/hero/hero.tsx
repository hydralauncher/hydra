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

/* The `?url` suffix forces Vite to import the SVG as its asset URL
   (a string) rather than the default SVGR-style React component the
   project's *.svg module declaration types these to. We need a URL
   to feed into <img src> for the reason chip glyphs. The NES
   controller SVG is the one remaining file-backed glyph — Primer
   Octicons has nothing equivalent for a retro-controller shape, so
   we keep this asset (it uses `fill="currentColor"` so it tints
   with the badge text color and visually matches the Octicon set). */
import nesControllerSvg from "@renderer/assets/icons/nes-controller.svg?url";

import "./hero.scss";

const ROTATION_INTERVAL_MS = 9_000;
const RESUME_DELAY_MS = 500;
/** 5 game-backed slides. Drawn from the 9-kind candidate pool with
 *  all kinds equal-weighted — the first 5 shuffled kinds that
 *  produce a renderable slide are taken (see the composer below). */
const MAX_GAME_SLIDES = 5;
/* Cache key is versioned — bump the suffix whenever the cached
   composition rules change so stale entries (e.g. a roll committed
   before the new SlideReason kinds existed) are dropped instead of
   replayed. v13 = classics slides now persist BOTH layouts' assets
   (cover + libraryHero + logo) via the new sourceAssets bag, so the
   cache replay path can re-render in either layout when the user
   toggles classicsUseHeroLayout. v12 entries are missing those
   fallback fields, so we treat them as a miss and re-roll. */
const HERO_CACHE_KEY = "home:hero:session:v13";
/** The reason kinds the current SlideReason union understands. Cached
 *  entries that reference a kind NOT in this set (carried over from a
 *  prior schema where, say, `popular-this-week` existed) are dropped
 *  on hydration so the runtime never hands them to the reasonChip
 *  switch — that switch is exhaustive over the live union and would
 *  return undefined for an unknown kind, crashing the render. */
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
/** Px movement past which a mousedown becomes a drag (suppresses click). */
const DRAG_CLICK_GUARD_PX = 5;
/** Px dragged before the slide actually snaps to the next/prev one. */
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
  /** Optional pre-resolved synopsis. Most callers don't have one and
   *  the Hero fetches via getGameShopDetails. Cached entries DO carry
   *  one so the replay path doesn't need a re-fetch round-trip. */
  description?: string | null;
}

/* Reason a game is in the carousel. Drives the chip's icon, label
   and secondary line on the slide + the tab. Palette stays neutral
   (Hydra tokens only) — categories are distinguished by icon + text,
   not by colour. The set spans 9 game-backed kinds. */
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

/* The 9 game-backed candidate kinds Home builds. Hero picks `hot-now`
   mandatorily, then randomly samples 4 more from the remaining 8 (any
   for which Home supplied a candidate). Final 5 slides are themselves
   shuffled so the hot-now slide can land anywhere in the carousel —
   the user requirement: "always shown, but no matter the order". */
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
  /** Capped weekly hours. Required for `recently-played`. */
  hoursThisWeek?: number;
  /** Source-game info for the `because-you-played` chip. */
  seedGameTitle?: string;
  seedGameLogoUrl?: string | null;
  /** Library-side title used by `from-library` / `trophy-hunter`. */
  becauseOfTitle?: string;
}

interface HeroProps {
  /** One candidate per kind, supplied by home.tsx. The composer
   *  enforces hot-now and randomly picks 4 more from the rest. Any
   *  kind without a non-null candidate is silently dropped — sessions
   *  with no library signal may surface as few as 3-4 slides. */
  candidates?: HeroCandidate[];
  /** Generic discovery fill — used only when the candidate pool is
   *  empty (signed-out / brand-new install) so the Hero still rotates
   *  through more than the single hot-now slide. */
  discoveryPicks?: HeroPickGame[];
  /** When false (no library, no plays), the cache write doesn't wait
   *  for personalised kinds (from-library, recently-played, trophy-
   *  hunter, because-you-played, good-old-days). */
  hasLibrarySignal?: boolean;
  /** Re-rolled on every Hydra launch. Drives the candidate shuffle
   *  AND keys the levelDB cache so cross-launch reads are treated as
   *  cache miss. Pass the same value home.tsx generates for its row
   *  shuffler so the Hero and the row order re-roll together. */
  sessionSeed?: number;
  /** Optional popularity ordering used to refine the hot-now pick
   *  when the caller's hot-now candidate is missing OR when a
   *  curated /catalogue/featured entry intersects with it. Keeps
   *  the legacy popularity-precision rule alive ("Hydra's featured
   *  pick — but the one that's actually popular right now"). */
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
  /* Full asset bag captured from the original HeroPickGame at slide-
     build time. The renderer ignores this — its sole purpose is to
     let the cache writer persist EVERY asset the game has (cover,
     library hero, logo, etc.) so the cache-replay path can re-render
     the slide in the OTHER classics layout when the user toggles
     classicsUseHeroLayout mid-session. Without this, the cache only
     carried whichever layout was active when the slide was built —
     toggling the setting then dropped classics slides whose
     fallback-layout assets weren't persisted. */
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

/* Cached entry stores the FULL HeroPickGame data + reason for each
   slide — not just a (shop, objectId) ref. This lets the replay
   path render slides directly without re-resolving against the
   current props, so a cached pick still works even if upstream
   prop pipelines haven't repopulated yet on remount. The entry
   carries the `sessionSeed` that generated it so cross-launch
   reads (where home.tsx hands us a new sessionSeed) are treated
   as a cache miss and re-rolled. */
interface CachedSlide {
  game: HeroPickGame;
  reason: SlideReason;
}

interface SessionCacheEntry {
  /** Stamped sessionSeed — must match the current sessionSeed to be
   *  treated as a hit. New launch = new sessionSeed = re-roll. */
  sessionSeed: number;
  generatedAt: number;
  slides: CachedSlide[];
}

/* Reason → icon + primary label + secondary line. Icons mix
   @primer/octicons-react (sidebar/search dependency already), a few
   bundled asset images (flame/stars/trophy/nes-controller) and — for
   `because-you-played` — the seed game's own logo. Colour stays
   inherited from the surrounding text; categories distinguish via
   icon + text, not tint. */
function reasonChip(reason: SlideReason): {
  icon: React.ReactNode;
  primary: string;
  secondary: string;
} {
  /* Defensive: if a slide somehow carries a reason kind that's not
     in the current union (a stale cache that slipped past
     KNOWN_REASON_KINDS, a forwards-compat boundary, a typo on a
     future edit), fall back to a neutral chip so the carousel still
     renders. Without this fallback an exhaustive switch returns
     `undefined` for unknown kinds, and accessing `chip.icon` on that
     crashes the entire React tree. */
  const kind = reason?.kind as SlideReason["kind"] | undefined;
  if (!kind || !KNOWN_REASON_KINDS.has(kind)) {
    return {
      icon: <StarFillIcon size={14} />,
      primary: "Hot Now",
      secondary: "Trending on Hydra",
    };
  }
  /* All chip glyphs share one icon style: simple, single-colour,
     static — no animations. Sized at 14px to match the Octicon
     baseline already in use for ClockIcon / DownloadIcon /
     BookmarkFillIcon. The because-you-played slot is the one
     intentional exception (uses the seed game's logo so the chip
     reads "this came from THAT game" at a glance). */
  switch (reason.kind) {
    case "hot-now":
      return {
        icon: <FlameIcon size={14} />,
        primary: "Hot Now",
        secondary: "Most popular right now",
      };
    case "recently-played": {
      /* Format hours so values < 10 keep a single decimal ("3.4h
         this week") but values ≥ 10 round to whole hours ("12h
         this week"). Defensive: a stale cache may not carry
         `hours` — fall back to "—h" so the chip still renders. */
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
      /* Primer Octicons doesn't ship a sparkles glyph; StarFillIcon
         is the closest single-colour "this is special / discovery"
         mark and matches the same visual weight as Flame/Bookmark. */
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
      /* Defensive reads — a stale cache entry from a prior schema
         could land here with seedGameTitle missing. `.charAt()` on
         undefined would throw and (with no error boundary above
         Home) blank the whole app. Treat any missing field as a
         neutral placeholder. */
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

/* Strict slide builder. PC slides REQUIRE hero image + logo. Classics
   slides require cover. Caller skips any candidate the builder
   rejects, so the carousel never renders an incomplete slide. */
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

  /* Classics layout decision — defensive about asset availability.
     The user's classicsUseHeroLayout preference is honoured WHEN the
     necessary assets exist. If the preferred layout's assets are
     missing we fall back to the OTHER layout rather than silently
     dropping the slide. Previously: toggling the setting could blank
     out classics slides + their tabs because the cached HeroPickGame
     only carried the assets for whichever layout was active when the
     cache was written. Now we always render whichever layout has the
     assets, with the user's preference acting as a tie-breaker. */
  /* Capture every asset we know about — independent of which layout
     wins below — so the slide carries the full bag down to the cache
     writer. This is what makes toggling the classics-hero-layout
     setting cheap: both layouts' assets are persisted, and the
     replay path's buildSlide call can pick whichever layout the user
     just switched to. */
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
    /* Pick the preferred layout when its assets are present;
       otherwise pick whichever IS available. */
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

  /* Hover-tooltip text — long-form hours surfaced on the recently-
     played slide ("12.4 hours this week") in addition to the chip's
     short form. The user explicitly asked for hours-on-hover here. */
  const tooltipTitle =
    slide.reason.kind === "recently-played"
      ? `${slide.reason.hours.toFixed(1)} hours this week`
      : undefined;

  /* Reason badge — wraps the global Badge component but adds a
     two-line layout (icon + primary label + secondary context) so
     the user knows WHY this slide is in the carousel without
     leaving Hydra's visual language. No per-reason colour. */
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
  /* Ref on the outer hero container — read on every render to size
     the tabs' drag-parallax shift relative to actual rendered width
     (instead of guessing at a slide pixel size). */
  const heroRef = useRef<HTMLDivElement>(null);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const classicsUseHeroLayout = userPreferences?.classicsUseHeroLayout ?? false;

  /* ── Fetch /catalogue/featured ───────────────────────────────── */
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

  /* ── Hydrate session-picks cache on mount ─────────────────────
        The cache is now session-keyed rather than daily — entries
        stamped with a different sessionSeed than the current one are
        treated as a miss and re-rolled. This guarantees the user
        explicitly asked for: "everytime you open hydra, the rows and
        games displayed in the hero refresh in order and content". */
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
        /* Schema-validate every cached slide's reason kind against
           the live SlideReason union. If any slide carries an
           outdated kind (e.g. an older v9 roll written before a
           rename landed in the user's installed build), drop the
           whole entry rather than hand a stale kind to reasonChip
           later. */
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

  /* Cache hit only when the persisted seed matches THIS launch's
     sessionSeed. Mid-session navigation (Home → Catalogue → Home)
     paints instantly from cache; the next launch re-rolls. */
  const isCacheFresh =
    cachedEntry !== null && cachedEntry.sessionSeed === sessionSeed;

  /* ── Slide composition ─────────────────────────────────────
        New rules (replaces the legacy fixed-slot + supportingPicks
        pipeline):
          • 9 game-backed candidate kinds (hot-now, recently-played,
            most-downloaded-this-week, random-pick, from-library,
            good-old-days, hot-now-classics, trophy-hunter,
            because-you-played) supplied by home.tsx as a flat list.
          • All 9 kinds are EQUAL-WEIGHT — no slot is mandatory.
            The composer shuffles the 9 kinds via `sessionSeed`
            (mulberry32) and takes the first 5 that produce a
            renderable slide. Hot-now keeps its own resolver
            (/catalogue/featured ∩ popularityRanking) so when it IS
            drawn it still surfaces the most popular curated entry.
          • The accepted 5 are THEN shuffled again so the carousel
            order is also seed-randomised — same kind can land at
            any position across launches.
        Any candidate kind without a renderable slide (missing
        assets, dedup collision) is skipped silently rather than
        backfilled — better to show 4 valid slides than 5 with a
        broken render. */
  const slides = useMemo<HeroSlide[]>(() => {
    if (!cacheChecked) return [];

    /* Replay path — current session's cache exists. Render straight
       from the cached game payloads, no source-array resolution
       required. Decouples the carousel from whether the upstream
       prop pipelines have repopulated yet on this remount. */
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

    /* Fresh-roll path — derive picks from candidates + popularity. */

    /* Tiny mulberry32-style PRNG seeded by sessionSeed. Used for
       both candidate selection AND the final order shuffle. */
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

    /* Resolve the hot-now candidate. Prefer the one Home provided,
       fall back to /catalogue/featured intersected with
       popularityRanking (legacy popularity-precision rule), fall
       back further to popularityRanking[0], then featuredArr[0]. */
    const featuredArr = featured ?? [];
    const candidateByKind = new Map<HeroCandidateKind, HeroCandidate>();
    for (const c of candidates) {
      if (!candidateByKind.has(c.kind)) candidateByKind.set(c.kind, c);
    }

    const resolveHotNow = (): HeroPickGame | null => {
      const fromHome = candidateByKind.get("hot-now");
      if (fromHome) return fromHome.game;
      /* Intersect curated featured with popularity ranking. */
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

    /* Build the candidate→slide map. Hot-now goes in first so its
       dedup priority is highest. */
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

    /* Step 1: equal-weight draw across all 9 candidate kinds. Per
       the refined spec the Hero no longer forces `hot-now` into the
       carousel — every kind has the same chance of being drawn and
       the Hero takes the first 5 shuffled kinds that produce a
       renderable slide. The `hot-now` kind still has its own
       resolver (curated featured ∩ popularity ranking) so when it
       IS picked it surfaces the best popularity-precise entry. */
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
        /* Hot-now's resolver intersects /catalogue/featured with
           popularityRanking so even without a Home-supplied
           candidate it can still surface a slide. */
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

    /* Step 3: backfill from discovery picks only when the candidate
       pool produced fewer than 2 game-backed slides (effectively a
       brand-new install with no signal and an empty featured fetch).
       Falls back to neutral hot-now reason since the chip should
       still hint at popularity. */
    for (let i = 0; accepted.length < 2 && i < discoveryPicks.length; i++) {
      const built = tryBuild(
        discoveryPicks[i],
        { kind: "hot-now" },
        `disc-${i}`
      );
      if (built) accepted.push(built);
    }

    /* Step 4: final shuffle so hot-now can land anywhere in the
       carousel — the user requirement was explicit on this. */
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

  /* Persist fresh-roll picks to the session cache. Stamped with the
     current sessionSeed so a future launch (new seed) will re-roll.
     Only writes once the composition has at least 2 slides — under
     that bar the prop pipelines probably haven't populated yet and
     we'd freeze a half-built roll for the session.

     When the user has library signal we additionally wait for at
     least one personalised kind to land — keeps the cache from
     freezing on a discovery-only composition before recently-
     played / from-library / trophy-hunter arrives in candidates.

     Note: the prior `hasHotNow` gate is dropped per the refined
     spec (hot-now is no longer mandatory in the Hero). A fully
     valid roll can now consist of any 5 of the 9 kinds. */
  useEffect(() => {
    if (!cacheChecked || isCacheFresh) return;
    if (slides.length === 0) return;

    const kinds = new Set(slides.map((s) => s.reason.kind));
    /* Personalised kinds — drawn from library/play data. */
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

    /* Re-serialise the full game payload so the replay path on the
       next mount doesn't need the prop pipelines to repopulate. We
       persist EVERY asset (cover + library hero + logo + …) from the
       slide's sourceAssets bag, not just the active layout's. This is
       what lets toggling classicsUseHeroLayout mid-session re-render
       a classics slide in the other layout — the replay path's
       buildSlide call finds the assets it needs either way. */
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
        /* Prefer the live-fetched description (descriptions map) over
           the persisted one so a synopsis that arrived after the
           slide was built makes it into the cache. */
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

  /* ── Fetch missing synopses for PC slides ──────────────────── */
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

  /* ── Time-aware auto-rotate ─────────────────────────────── */
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
    if (slidesLen <= 1) return;
    const elapsed = Date.now() - slideStartRef.current - totalPausedRef.current;
    const remaining = Math.max(0, ROTATION_INTERVAL_MS - elapsed);
    advanceTimeoutRef.current = setTimeout(() => {
      setTrackIndex((t) => t + 1);
    }, remaining);
  }, [slidesLen]);

  useEffect(() => {
    slideStartRef.current = Date.now();
    totalPausedRef.current = 0;
    pauseStartRef.current = null;
    if (!paused) scheduleAdvance();
    return clearAdvanceTimeout;
  }, [displayIndex, scheduleAdvance, paused]);

  const handleTrackTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
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

  /* ── Mouse drag ────────────────────────────────────────── */
  const isMouseDownRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragDeltaRef = useRef(0);
  const wasDraggedRef = useRef(false);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (slidesLen <= 1) return;
      isMouseDownRef.current = true;
      dragStartXRef.current = e.clientX;
      dragDeltaRef.current = 0;
      wasDraggedRef.current = false;
      setIsDragging(true);
      setDragOffset(0);
      handleMouseEnter();
    },
    [slidesLen, handleMouseEnter]
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
      setDragOffset(delta);
    };

    const onUp = () => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      const delta = dragDeltaRef.current;
      dragDeltaRef.current = 0;

      setIsDragging(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setDragOffset(0);
          if (Math.abs(delta) > DRAG_SNAP_THRESHOLD_PX && slidesLen > 1) {
            if (delta < 0) {
              setTrackIndex((t) => Math.min(slidesLen + 1, t + 1));
            } else {
              setTrackIndex((t) => Math.max(0, t - 1));
            }
          }
        });
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, slidesLen]);

  const handleMouseLeave = useCallback(() => {
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

  useEffect(
    () => () => {
      clearAdvanceTimeout();
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    },
    []
  );

  /* Render the skeleton placeholder while there's still a chance
     a slide composition lands. Two windows count:
       1. The featured fetch is in flight AND we haven't seen
          either featured data or a cached entry yet.
       2. The session cache hasn't been hydrated yet (cacheChecked
          is false), so the composer can't have produced slides.
     Previously this rendered <null> in window (2), which collapsed
     ~300px of Hero height on Home remount — content above the
     user's saved scrollTop shrank, and the scroll-restore landed
     1-2 rows past where they actually were. */
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

  /* Drag fraction (-1..+1) used to drive the tabs' parallax shift.
     +1 means the user dragged a full hero width to the right (going
     to the previous slide); -1 means a full drag left (next slide).
     We read clientWidth at render time so resizes don't desync. */
  const heroWidth = heroRef.current?.clientWidth ?? 0;
  const dragFraction =
    isDragging && heroWidth > 0
      ? Math.max(-1, Math.min(1, dragOffset / heroWidth))
      : 0;

  return (
    /* The hero wrapper carries mouse handlers for drag-to-advance
       and auto-rotate pause/resume; both behaviours are
       supplementary to the inner clickable slide <button>s.
       Keyboard / AT users navigate the slide buttons + tab buttons
       directly, so adding a misleading interactive role on this
       wrapper would confuse screen readers. */
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
                  /* Parallax shift — tabs follow the drag direction
                     opposite to the track. Capped at ±10px. */
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
            /* Live drag-driven fill override. While the user is
               dragging the carousel, the active tab visibly drains
               and the destination tab (next on negative dragFraction,
               previous on positive) visibly fills, both at the same
               rate as the cursor travel — so the progress reads as
               smoothly handing off from one tab to the next instead
               of holding static and snapping after release.

               `transition: none` keeps the inline scaleX value
               tracking 1:1 with the drag; the carousel's normal
               class-based transition picks back up on release. */
            let fillStyle: React.CSSProperties | undefined;
            if (isDragging) {
              const t = Math.abs(dragFraction);
              const nextIndex = (displayIndex + 1) % slides.length;
              const prevIndex =
                (displayIndex - 1 + slides.length) % slides.length;
              if (i === displayIndex) {
                fillStyle = {
                  transform: `scaleX(${1 - t})`,
                  transition: "none",
                  animation: "none",
                };
              } else if (dragFraction < 0 && i === nextIndex) {
                fillStyle = {
                  transform: `scaleX(${t})`,
                  transition: "none",
                  animation: "none",
                };
              } else if (dragFraction > 0 && i === prevIndex) {
                /* Previous tab was already at scaleX(1) under the
                   --past class; lock it so the override above for
                   the active tab doesn't make the transition
                   re-engage. */
                fillStyle = {
                  transform: "scaleX(1)",
                  transition: "none",
                  animation: "none",
                };
              }
            }
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
                  style={fillStyle}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
