import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GameStats } from "@types";
import type { GameShop } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";
import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import { Badge, StarRating } from "@renderer/components";
import { useFormat } from "@renderer/hooks";

import { ShopLogo } from "./shop-logo";
import { CardFriendsBadge } from "./card-friends-badge";

import "./home-game-card.scss";

export interface HomeRowGame {
  objectId: string;
  shop: GameShop;
  title: string;
  libraryImageUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  coverImageUrl?: string | null;
  logoImageUrl?: string | null;
  downloadSources?: string[];
  platform?: string | null;
  /* Optional list of genres carried through from catalogue rows. The
     discovery rows use this for per-row tag fallback when steamspy
     data is missing; the card itself ignores it. Existed implicitly
     before — declared explicitly so the catalogue-to-row mapper
     compiles cleanly under strict TS. Mutable to align with the
     duplicate declaration in home-game-card-vertical.tsx. */
  genres?: string[];
  /* Optional library-derived fields used by the Recently Played row's
     dedicated card variant (home-recently-played-card.tsx). Discovery
     rows omit these — they remain undefined and the variant falls back
     to placeholder values. Carried on this shared type so library rows
     can pass enriched data through without a separate interface. */
  playTimeInMilliseconds?: number;
  achievementCount?: number;
  unlockedAchievementCount?: number;
  lastTimePlayed?: string | Date | null;
}

interface HomeGameCardProps {
  game: HomeRowGame;
}

const resolveImageSrc = (
  url: string | null | undefined
): string | undefined => {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  )
    return trimmed;
  if (trimmed.startsWith("local:"))
    return `local:${trimmed.slice("local:".length).replaceAll("\\", "/")}`;
  const normalized = trimmed.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/"))
    return `local:${normalized}`;
  return normalized;
};

function HomeGameCardImpl({ game }: HomeGameCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("game_card");
  const [stats, setStats] = useState<GameStats | null>(null);
  const { numberFormatter } = useFormat();

  const isClassics = game.shop === "launchbox";

  const handleHover = useCallback(() => {
    /* Fetch stats on hover for every card. Classics rows used to skip
       this — now they participate too so each card has the same info
       footprint (downloads / players / rating). The API may return
       null for classics; the UI shows a placeholder dash in that case. */
    if (!stats) {
      window.electron
        .getGameStats(game.objectId, game.shop)
        .then((s) => {
          if (s) setStats(s);
        })
        .catch(() => {});
    }
  }, [game.objectId, game.shop, stats]);

  /* Image source fallback chain — mirrors the LibraryGameCard
     pattern. Earlier this card just used the first available URL
     and hoped it loaded; some catalogue entries (the PEAK-style
     edge case the user reported on the library page) have a
     null/broken `libraryImageUrl` so the card rendered nothing or
     a wrong-shape image. The library card fixed this by walking a
     cascade of alternative sources via `onError`; same chain
     applied here so PC + Classics both recover cleanly.

     PC card aspect is ~2.13 (landscape header), so we PREFER
     landscape sources at the top of the chain; the portrait
     `coverImageUrl` is appended last so the card still shows
     SOMETHING when both landscape sources are missing.

     Classics aspect is ~2.13 but content is a centered portrait on
     a blurred backdrop, so we PREFER portrait sources at the top
     and fall through to landscape if the portrait is missing. */
  const imageSources = useMemo(() => {
    const chain = isClassics
      ? [game.coverImageUrl, game.libraryImageUrl, game.libraryHeroImageUrl]
      : [game.libraryImageUrl, game.libraryHeroImageUrl, game.coverImageUrl];
    return chain.map(resolveImageSrc).filter((u): u is string => !!u);
  }, [
    isClassics,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.libraryHeroImageUrl,
  ]);

  const [fallbackIndex, setFallbackIndex] = useState(0);
  /* Reset the fallback walk whenever the underlying game changes —
     the React.memo comparator above usually skips re-renders when
     identity stays the same, but a row that swaps game data
     (sliceDiscovery re-pick after a refresh) needs a clean start. */
  useEffect(() => {
    setFallbackIndex(0);
  }, [game.objectId, game.shop]);
  const handleImageError = useCallback(() => {
    setFallbackIndex((i) => (i < imageSources.length - 1 ? i + 1 : i));
  }, [imageSources.length]);

  /* Aspect-ratio sanity check for PC cards (landscape header, ratio
     ≈ 2.13). Mirrors the vertical-card check but for the opposite
     orientation: if a loaded image is clearly taller than wide
     (H >= W * 1.3, i.e. portrait box-art served from the wrong
     URL), treat it as a fallback advance. Classics cards use a
     blurred portrait backdrop + centred contain-fit portrait — the
     aspect is intentionally portrait there, so the check skips
     classics. */
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (isClassics) return;
      const img = e.currentTarget;
      if (img.naturalWidth === 0 || img.naturalHeight === 0) return;
      if (img.naturalHeight >= img.naturalWidth * 1.3) {
        handleImageError();
      }
    },
    [isClassics, handleImageError]
  );
  const resolvedUrl = imageSources[fallbackIndex];

  /* Only show source badges when data is explicitly populated.
     undefined means the row type doesn't carry source data (e.g. library rows). */
  const downloadSources = game.downloadSources;
  const hasSources =
    Array.isArray(downloadSources) && downloadSources.length > 0;

  return (
    <button
      type="button"
      className={`home-game-card${isClassics ? " home-game-card--classics" : ""}`}
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={handleHover}
    >
      {/* ── Image layer ─────────────────────────────────────────── */}
      {isClassics ? (
        <>
          {resolvedUrl && (
            <img
              src={resolvedUrl}
              alt=""
              aria-hidden="true"
              className="home-game-card__blur-bg"
              loading="lazy"
              decoding="async"
              onError={handleImageError}
              onLoad={handleImageLoad}
            />
          )}
          {resolvedUrl && (
            <img
              src={resolvedUrl}
              alt={game.title}
              className="home-game-card__portrait-cover"
              loading="lazy"
              decoding="async"
              onError={handleImageError}
              onLoad={handleImageLoad}
            />
          )}
          {/* Platform chip removed — the per-shop ShopLogo in the
              title row already conveys the platform, so a separate
              corner badge was redundant. */}
        </>
      ) : (
        resolvedUrl && (
          <img
            src={resolvedUrl}
            alt={game.title}
            className="home-game-card__img"
            loading="lazy"
            onError={handleImageError}
            onLoad={handleImageLoad}
          />
        )
      )}

      {/* ── Gradient overlay + sliding content ──────────────────── */}
      <div className="home-game-card__backdrop">
        <div className="home-game-card__content">
          <div className="home-game-card__title-container">
            {/* Per-platform logo: Steam mark for PC catalogue games,
                PS1/PS2/PS3 marks for launchbox classics (driven by
                platformToSystem inside ShopLogo). */}
            <ShopLogo game={game} className="home-game-card__shop-icon" />
            <p className="home-game-card__title">{game.title}</p>
          </div>

          {hasSources ? (
            <ul className="home-game-card__download-options">
              {downloadSources!.slice(0, 3).map((sourceName) => (
                <li key={sourceName}>
                  <Badge>{sourceName}</Badge>
                </li>
              ))}
              {downloadSources!.length > 3 && (
                <li>
                  <Badge>
                    +{downloadSources!.length - 3}{" "}
                    {t("available", { count: downloadSources!.length - 3 })}
                  </Badge>
                </li>
              )}
            </ul>
          ) : Array.isArray(downloadSources) || isClassics ? (
            /* Show "no downloads" whenever we KNOW there are none —
               either downloadSources is an explicit empty array (PC
               row that fetched sources but matched none) OR the
               card is a classics one (downloads aren't supported for
               those yet regardless of whether the source data was
               fetched). Stays hidden when downloadSources is
               `undefined` for a non-classics card (row type doesn't
               carry source data — we don't claim no downloads when
               we never checked). */
            <p className="home-game-card__no-downloads">{t("no_downloads")}</p>
          ) : null}

          {/* Stats row — rises into view as the content slides up on hover.
              Shown for both PC and Classics now. Falls back to "—" when
              the API has no data for a game (most classics). */}
          <div className="home-game-card__specifics">
            <div className="home-game-card__specifics-item">
              <DownloadIcon size={14} />
              <span>
                {stats ? numberFormatter.format(stats.downloadCount) : "—"}
              </span>
            </div>
            <div className="home-game-card__specifics-item">
              <PeopleIcon size={14} />
              <span>
                {stats ? numberFormatter.format(stats.playerCount) : "—"}
              </span>
            </div>
            <div className="home-game-card__specifics-item">
              <StarRating rating={stats?.averageScore ?? null} size={14} />
            </div>
            {/* Friend-playing badge — auto-hides when no friends are
                in the game. Pushed to the end so the rest of the stats
                stay anchored to the left, in their original order. */}
            <div className="home-game-card__specifics-item home-game-card__specifics-item--friends">
              <CardFriendsBadge game={game} />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/* React.memo with custom comparator — even when HomeRow re-renders
   (e.g., from `setAtStart` firing on the first scroll tick of a
   drag), each card's props (`game` object) are typically the SAME
   object across renders. Default shallow comparison would already
   short-circuit, but specs upstream sometimes re-derive arrays of
   games (sliceDiscovery isn't memoized), making `game` a different
   reference for the same logical game. The custom comparator falls
   back to `objectId` + `shop` equality, which is the canonical
   identity for a HomeRowGame. Skip re-renders when the same game
   is being shown — that's most of the time during drag/scroll. */
export const HomeGameCard = memo(HomeGameCardImpl, (prev, next) => {
  /* Only the `game` prop matters for re-render decisions. Compare
     by shop+objectId (canonical identity) plus the fields the card
     actually displays (so a stats update or image url update still
     forces a re-render). */
  const a = prev.game;
  const b = next.game;
  return (
    a.shop === b.shop &&
    a.objectId === b.objectId &&
    a.title === b.title &&
    a.libraryImageUrl === b.libraryImageUrl &&
    a.libraryHeroImageUrl === b.libraryHeroImageUrl &&
    a.coverImageUrl === b.coverImageUrl &&
    a.logoImageUrl === b.logoImageUrl &&
    (a.downloadSources?.length ?? 0) === (b.downloadSources?.length ?? 0)
  );
});
