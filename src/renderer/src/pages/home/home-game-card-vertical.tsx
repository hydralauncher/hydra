import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GameShop, GameStats } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";
import { DownloadIcon, PeopleIcon, ImageIcon } from "@primer/octicons-react";
import { Badge, StarRating } from "@renderer/components";
import { useFormat } from "@renderer/hooks";

import { ShopLogo } from "./shop-logo";
import { CardFriendsBadge } from "./card-friends-badge";

import "./home-game-card-vertical.scss";

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
}

interface HomeGameCardVerticalProps {
  game: HomeRowGame;
}

const resolveImageSrc = (
  url: string | null | undefined
): string | undefined => {
  if (!url) return undefined;
  const t = url.trim();
  if (!t) return undefined;
  if (
    t.startsWith("http://") ||
    t.startsWith("https://") ||
    t.startsWith("data:") ||
    t.startsWith("blob:")
  )
    return t;
  if (t.startsWith("local:"))
    return `local:${t.slice("local:".length).replaceAll("\\", "/")}`;
  const n = t.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(n) || n.startsWith("/")) return `local:${n}`;
  return n;
};

function HomeGameCardVerticalImpl({ game }: HomeGameCardVerticalProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("game_card");
  const { numberFormatter } = useFormat();
  const [stats, setStats] = useState<GameStats | null>(null);

  const isClassics = game.shop === "launchbox";

  const imageSources = useMemo(() => {
    if (isClassics) {
      return [
        resolveImageSrc(game.coverImageUrl),
        resolveImageSrc(game.libraryImageUrl),
        resolveImageSrc(game.libraryHeroImageUrl),
      ].filter((u): u is string => !!u);
    }
    const list: (string | undefined)[] = [];
    if (game.shop === "steam") {
      list.push(
        `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900_2x.jpg`
      );
    }
    list.push(resolveImageSrc(game.coverImageUrl));
    list.push(resolveImageSrc(game.libraryImageUrl));
    list.push(resolveImageSrc(game.libraryHeroImageUrl));
    return list.filter((u): u is string => !!u);
  }, [
    isClassics,
    game.shop,
    game.objectId,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.libraryHeroImageUrl,
  ]);

  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setFallbackIndex(0);
    setImageError(false);
  }, [game.objectId, game.shop]);

  const activeSrc = imageSources[fallbackIndex];

  const handleImageError = useCallback(() => {
    if (fallbackIndex < imageSources.length - 1) {
      setFallbackIndex((i) => i + 1);
    } else {
      setImageError(true);
    }
  }, [fallbackIndex, imageSources.length]);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (img.naturalWidth === 0 || img.naturalHeight === 0) return;
      if (img.naturalWidth >= img.naturalHeight * 1.3) {
        handleImageError();
      }
    },
    [handleImageError]
  );

  const downloadSources = game.downloadSources;
  const hasSources =
    Array.isArray(downloadSources) && downloadSources.length > 0;

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

  return (
    <button
      type="button"
      className="home-game-card-vertical"
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={handleHover}
    >
      {imageError || !activeSrc ? (
        <div className="home-game-card-vertical__placeholder">
          <ImageIcon size={48} />
        </div>
      ) : isClassics ? (
        <>
          <img
            src={activeSrc}
            alt=""
            aria-hidden="true"
            className="home-game-card-vertical__blur-bg"
            loading="lazy"
            decoding="async"
            onError={handleImageError}
            onLoad={handleImageLoad}
          />
          <img
            src={activeSrc}
            alt={game.title}
            className="home-game-card-vertical__portrait"
            loading="lazy"
            decoding="async"
            onError={handleImageError}
            onLoad={handleImageLoad}
          />
        </>
      ) : (
        <img
          src={activeSrc}
          alt={game.title}
          className="home-game-card-vertical__cover"
          loading="lazy"
          onError={handleImageError}
        />
      )}

      {/* Platform chip removed — the per-shop ShopLogo in the bottom
          title row already conveys the platform, so a separate
          corner badge was redundant. */}

      {/* Bottom gradient — fades the image to black so the footer copy
          stays readable regardless of what's behind it. */}
      <div className="home-game-card-vertical__backdrop" aria-hidden="true" />

      <div className="home-game-card-vertical__content">
        <div className="home-game-card-vertical__title-container">
          <ShopLogo
            game={game}
            className="home-game-card-vertical__shop-icon"
          />
          <p className="home-game-card-vertical__title">{game.title}</p>
        </div>

        {/* Sources / no-downloads — always visible at the bottom so
            users can scan availability without hovering. */}
        {hasSources ? (
          <ul className="home-game-card-vertical__download-options">
            {downloadSources!.slice(0, 2).map((sourceName) => (
              <li key={sourceName}>
                <Badge>{sourceName}</Badge>
              </li>
            ))}
            {downloadSources!.length > 2 && (
              <li>
                <Badge>
                  +{downloadSources!.length - 2}{" "}
                  {t("available", { count: downloadSources!.length - 2 })}
                </Badge>
              </li>
            )}
          </ul>
        ) : Array.isArray(downloadSources) || isClassics ? (
          <p className="home-game-card-vertical__no-downloads">
            {t("no_downloads")}
          </p>
        ) : null}

        {/* Stats row still expands in on hover only — keeps the resting
            footer compact while exposing the extra detail when the user
            shows interest. */}
        <div className="home-game-card-vertical__hover-section">
          <div className="home-game-card-vertical__specifics">
            <div className="home-game-card-vertical__specifics-item">
              <DownloadIcon size={14} />
              <span>
                {stats ? numberFormatter.format(stats.downloadCount) : "—"}
              </span>
            </div>
            <div className="home-game-card-vertical__specifics-item">
              <PeopleIcon size={14} />
              <span>
                {stats ? numberFormatter.format(stats.playerCount) : "—"}
              </span>
            </div>
            <div className="home-game-card-vertical__specifics-item">
              <StarRating rating={stats?.averageScore ?? null} size={14} />
            </div>
            {/* Friend-playing badge — auto-hides when no friends play
                this game. */}
            <div className="home-game-card-vertical__specifics-item home-game-card-vertical__specifics-item--friends">
              <CardFriendsBadge game={game} />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

export const HomeGameCardVertical = memo(
  HomeGameCardVerticalImpl,
  (prev, next) => {
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
  }
);
