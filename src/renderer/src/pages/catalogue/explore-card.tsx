import { useCallback, useEffect, useState } from "react";
import type { CatalogueSearchResult, GameStats, ShopAssets } from "@types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useFormat } from "@renderer/hooks";
import {
  DownloadIcon,
  PeopleIcon,
  PlusIcon,
  CheckIcon,
} from "@primer/octicons-react";
import { StarRating } from "@renderer/components/star-rating/star-rating";
import { useLibrary } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import cn from "classnames";

import "./explore-card.scss";

interface ExploreCardProps {
  game: CatalogueSearchResult;
  index: number;
}

export function ExploreCard({ game, index }: ExploreCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("catalogue");
  const { t: tDetails } = useTranslation("game_details");
  const { numberFormatter } = useFormat();
  const { library, updateLibrary } = useLibrary();

  const [stats, setStats] = useState<GameStats | null>(null);
  const [assets, setAssets] = useState<ShopAssets | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const inLibrary = library.some(
    (g) => g.shop === game.shop && g.objectId === game.objectId
  );

  useEffect(() => {
    window.electron.getGameAssets(game.objectId, game.shop).then((result) => {
      if (result) setAssets(result);
    });
  }, [game.objectId, game.shop]);

  const handleHover = useCallback(() => {
    if (!stats) {
      window.electron.getGameStats(game.objectId, game.shop).then((result) => {
        setStats(result);
      });
    }
  }, [game.objectId, game.shop, stats]);

  const addToLibrary = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (inLibrary || isAdding) return;
    setIsAdding(true);
    try {
      await window.electron.addGameToLibrary(
        game.shop,
        game.objectId,
        game.title
      );
      updateLibrary();
    } catch (error) {
      logger.error("Failed to add game to library", error);
    } finally {
      setIsAdding(false);
    }
  };

  const isAvailable = game.downloadSources.length > 0;
  const coverImage =
    assets?.libraryHeroImageUrl ??
    assets?.libraryImageUrl ??
    game.libraryImageUrl;

  return (
    <button
      type="button"
      className={cn("explore-card", {
        "explore-card--unavailable": !isAvailable,
      })}
      style={{ "--stagger-delay": `${index * 35}ms` } as React.CSSProperties}
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={handleHover}
    >
      <div className="explore-card__image-wrapper">
        <img
          src={coverImage ?? undefined}
          alt={game.title}
          className="explore-card__image"
          loading="lazy"
        />
        <div className="explore-card__overlay" />

        <div
          className={cn("explore-card__library-btn", {
            "explore-card__library-btn--added": inLibrary,
          })}
          role="button"
          tabIndex={-1}
          onClick={addToLibrary}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") addToLibrary(e);
          }}
          title={
            inLibrary
              ? tDetails("already_in_library")
              : tDetails("add_to_library")
          }
        >
          {inLibrary ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
        </div>

        {stats && (
          <div className="explore-card__hover-stats">
            <div className="explore-card__hover-stat">
              <DownloadIcon size={11} />
              <span>{numberFormatter.format(stats.downloadCount)}</span>
            </div>
            <div className="explore-card__hover-stat">
              <PeopleIcon size={11} />
              <span>{numberFormatter.format(stats.playerCount)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="explore-card__body">
        <div className="explore-card__info">
          <span className="explore-card__title">{game.title}</span>

          {game.genres?.length > 0 && (
            <div className="explore-card__genres">
              {game.genres.slice(0, 2).map((g) => (
                <span key={g} className="explore-card__genre">
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="explore-card__footer">
          <span
            className={cn("explore-card__availability", {
              "explore-card__availability--available": isAvailable,
            })}
          >
            {isAvailable ? t("available") : t("not_available")}
          </span>

          {stats?.averageScore != null && (
            <StarRating rating={stats.averageScore} size={12} />
          )}
        </div>
      </div>
    </button>
  );
}
