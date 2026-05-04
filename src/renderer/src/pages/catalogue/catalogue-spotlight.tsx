import { useCallback, useEffect, useState } from "react";
import type { ShopAssets, ShopDetailsWithAssets, GameStats } from "@types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useFormat } from "@renderer/hooks";
import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import { StarRating } from "@renderer/components/star-rating/star-rating";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";

import "./catalogue-spotlight.scss";

interface SpotlightCardProps {
  game: ShopAssets;
  variant: "large" | "small";
}

function SpotlightCard({ game, variant }: SpotlightCardProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("catalogue");
  const { numberFormatter } = useFormat();
  const [details, setDetails] = useState<ShopDetailsWithAssets | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [assets, setAssets] = useState<ShopAssets | null>(null);

  useEffect(() => {
    window.electron.getGameAssets(game.objectId, game.shop).then((result) => {
      if (result) setAssets(result);
    });

    if (variant === "large") {
      const language = i18n.language.split("-")[0];
      window.electron
        .getGameShopDetails(game.objectId, game.shop, language)
        .then((result) => {
          if (result) setDetails(result);
        });
    }
  }, [game.objectId, game.shop, variant, i18n.language]);

  const handleHover = useCallback(() => {
    if (!stats) {
      window.electron.getGameStats(game.objectId, game.shop).then((result) => {
        setStats(result);
      });
    }
  }, [game.objectId, game.shop, stats]);

  const isAvailable = game.downloadSources.length > 0;
  const genres = details?.genres?.slice(0, 3) ?? [];
  const screenshot = details?.screenshots?.[0];

  const heroImage =
    assets?.libraryHeroImageUrl ??
    game.libraryHeroImageUrl ??
    assets?.libraryImageUrl ??
    game.libraryImageUrl;

  return (
    <button
      type="button"
      className={cn("spotlight-card", `spotlight-card--${variant}`, {
        "spotlight-card--unavailable": !isAvailable,
      })}
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={handleHover}
    >
      <div className="spotlight-card__image-wrapper">
        <img
          src={heroImage ?? undefined}
          alt={game.title}
          className="spotlight-card__image"
          loading="lazy"
        />
        <div className="spotlight-card__gradient" />
      </div>

      {variant === "large" && screenshot && (
        <div className="spotlight-card__screenshot">
          <img
            src={screenshot.path_thumbnail}
            alt=""
            className="spotlight-card__screenshot-img"
            loading="lazy"
          />
        </div>
      )}

      <div className="spotlight-card__content">
        <h3 className="spotlight-card__title">{game.title}</h3>

        {variant === "large" && details?.short_description && (
          <p className="spotlight-card__description">
            {details.short_description}
          </p>
        )}

        {genres.length > 0 && (
          <div className="spotlight-card__genres">
            {genres.map((g) => (
              <span key={g.id} className="spotlight-card__genre-tag">
                {g.description}
              </span>
            ))}
          </div>
        )}

        <div className="spotlight-card__footer">
          <span
            className={cn("spotlight-card__availability", {
              "spotlight-card__availability--available": isAvailable,
            })}
          >
            {isAvailable ? t("available") : t("not_available")}
          </span>

          {stats && (
            <div className="spotlight-card__stats">
              <div className="spotlight-card__stat">
                <DownloadIcon size={12} />
                <span>{numberFormatter.format(stats.downloadCount)}</span>
              </div>
              <div className="spotlight-card__stat">
                <PeopleIcon size={12} />
                <span>{numberFormatter.format(stats.playerCount)}</span>
              </div>
              <StarRating rating={stats.averageScore} size={12} />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

interface CatalogueSpotlightProps {
  title: string;
  games: ShopAssets[];
  isLoading?: boolean;
}

export function CatalogueSpotlight({
  title,
  games,
  isLoading,
}: CatalogueSpotlightProps) {
  if (isLoading) {
    return (
      <section className="catalogue-spotlight">
        <h2 className="catalogue-spotlight__heading">{title}</h2>
        <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
          <div className="catalogue-spotlight__grid">
            <Skeleton className="catalogue-spotlight__skeleton-large" />
            <div className="catalogue-spotlight__small-column">
              <Skeleton className="catalogue-spotlight__skeleton-small" />
              <Skeleton className="catalogue-spotlight__skeleton-small" />
              <Skeleton className="catalogue-spotlight__skeleton-small" />
            </div>
          </div>
        </SkeletonTheme>
      </section>
    );
  }

  if (games.length < 4) return null;

  return (
    <section className="catalogue-spotlight">
      <h2 className="catalogue-spotlight__heading">{title}</h2>
      <div className="catalogue-spotlight__grid">
        <SpotlightCard game={games[0]} variant="large" />
        <div className="catalogue-spotlight__small-column">
          {games.slice(1, 4).map((game) => (
            <SpotlightCard key={game.objectId} game={game} variant="small" />
          ))}
        </div>
      </div>
    </section>
  );
}
