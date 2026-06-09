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
  genres?: string[];
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
    if (!stats) {
      window.electron
        .getGameStats(game.objectId, game.shop)
        .then((s) => {
          if (s) setStats(s);
        })
        .catch(() => {});
    }
  }, [game.objectId, game.shop, stats]);

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
  useEffect(() => {
    setFallbackIndex(0);
  }, [game.objectId, game.shop]);
  const handleImageError = useCallback(() => {
    setFallbackIndex((i) => (i < imageSources.length - 1 ? i + 1 : i));
  }, [imageSources.length]);

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

export const HomeGameCard = memo(HomeGameCardImpl, (prev, next) => {
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
