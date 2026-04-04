import { useCallback, useState } from "react";
import type { ShopAssets, GameStats } from "@types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useFormat } from "@renderer/hooks";
import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import { StarRating } from "@renderer/components/star-rating/star-rating";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";

import "./catalogue-ranking.scss";

interface RankingCardProps {
  game: ShopAssets;
  rank: number;
}

function RankingCard({ game, rank }: RankingCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("catalogue");
  const { numberFormatter } = useFormat();
  const [stats, setStats] = useState<GameStats | null>(null);

  const handleHover = useCallback(() => {
    if (!stats) {
      window.electron.getGameStats(game.objectId, game.shop).then((result) => {
        setStats(result);
      });
    }
  }, [game.objectId, game.shop, stats]);

  const isAvailable = game.downloadSources.length > 0;

  return (
    <button
      type="button"
      className={cn("ranking-card", {
        "ranking-card--unavailable": !isAvailable,
        "ranking-card--top-3": rank <= 3,
      })}
      style={{ "--stagger-delay": `${rank * 50}ms` } as React.CSSProperties}
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={handleHover}
    >
      <div className="ranking-card__rank">
        <span
          className={cn("ranking-card__rank-number", {
            "ranking-card__rank-number--gold": rank === 1,
            "ranking-card__rank-number--silver": rank === 2,
            "ranking-card__rank-number--bronze": rank === 3,
          })}
        >
          {rank}
        </span>
      </div>

      <div className="ranking-card__image-wrapper">
        <img
          src={game.libraryImageUrl ?? undefined}
          alt={game.title}
          className="ranking-card__image"
          loading="lazy"
        />
      </div>

      <div className="ranking-card__details">
        <span className="ranking-card__title">{game.title}</span>
        <span
          className={cn("ranking-card__availability", {
            "ranking-card__availability--available": isAvailable,
          })}
        >
          {isAvailable ? t("available") : t("not_available")}
        </span>
      </div>

      <div className="ranking-card__stats">
        {stats ? (
          <>
            <div className="ranking-card__stat">
              <DownloadIcon size={12} />
              <span>{numberFormatter.format(stats.downloadCount)}</span>
            </div>
            <div className="ranking-card__stat">
              <PeopleIcon size={12} />
              <span>{numberFormatter.format(stats.playerCount)}</span>
            </div>
            <StarRating rating={stats.averageScore} size={12} />
          </>
        ) : (
          <span className="ranking-card__stat-placeholder">...</span>
        )}
      </div>
    </button>
  );
}

interface CatalogueRankingProps {
  title: string;
  icon?: React.ReactNode;
  games: ShopAssets[];
  isLoading?: boolean;
}

export function CatalogueRanking({
  title,
  icon,
  games,
  isLoading,
}: CatalogueRankingProps) {
  if (isLoading) {
    return (
      <section className="catalogue-ranking">
        <h2 className="catalogue-ranking__heading">{title}</h2>
        <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
          <div className="catalogue-ranking__list">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="catalogue-ranking__skeleton" />
            ))}
          </div>
        </SkeletonTheme>
      </section>
    );
  }

  if (!games.length) return null;

  return (
    <section className="catalogue-ranking">
      <div className="catalogue-ranking__header">
        {icon && <span className="catalogue-ranking__icon">{icon}</span>}
        <h2 className="catalogue-ranking__heading">{title}</h2>
      </div>
      <div className="catalogue-ranking__list">
        {games.slice(0, 10).map((game, index) => (
          <RankingCard key={game.objectId} game={game} rank={index + 1} />
        ))}
      </div>
    </section>
  );
}
