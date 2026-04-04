import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import type { ShopAssets, GameStats } from "@types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useFormat } from "@renderer/hooks";
import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import { StarRating } from "@renderer/components/star-rating/star-rating";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";

import "./catalogue-section.scss";

interface CatalogueSectionCardProps {
  game: ShopAssets;
  index: number;
}

function CatalogueSectionCard({ game, index }: CatalogueSectionCardProps) {
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
      className={cn("catalogue-section__card", {
        "catalogue-section__card--unavailable": !isAvailable,
      })}
      style={{ "--stagger-delay": `${index * 50}ms` } as React.CSSProperties}
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={handleHover}
    >
      <div className="catalogue-section__card-image-wrapper">
        <img
          src={game.libraryImageUrl ?? undefined}
          alt={game.title}
          className="catalogue-section__card-image"
          loading="lazy"
        />
        <div className="catalogue-section__card-overlay" />

        <div className="catalogue-section__card-stats">
          {stats && (
            <>
              <div className="catalogue-section__card-stat">
                <DownloadIcon size={12} />
                <span>{numberFormatter.format(stats.downloadCount)}</span>
              </div>
              <div className="catalogue-section__card-stat">
                <PeopleIcon size={12} />
                <span>{numberFormatter.format(stats.playerCount)}</span>
              </div>
              <StarRating rating={stats.averageScore} size={12} />
            </>
          )}
        </div>
      </div>

      <div className="catalogue-section__card-info">
        <span className="catalogue-section__card-title">{game.title}</span>
        <span
          className={cn("catalogue-section__card-availability", {
            "catalogue-section__card-availability--available": isAvailable,
          })}
        >
          {isAvailable ? t("available") : t("not_available")}
        </span>
      </div>
    </button>
  );
}

interface CatalogueSectionProps {
  title: string;
  icon?: React.ReactNode;
  games: ShopAssets[];
  isLoading?: boolean;
}

export function CatalogueSection({
  title,
  icon,
  games,
  isLoading,
}: CatalogueSectionProps) {
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    slidesToScroll: 3,
    containScroll: "trimSnaps",
    dragFree: true,
  });

  const updateButtons = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", updateButtons);
    emblaApi.on("reInit", updateButtons);
    updateButtons();

    return () => {
      emblaApi.off("select", updateButtons);
      emblaApi.off("reInit", updateButtons);
    };
  }, [emblaApi, updateButtons]);

  return (
    <section className="catalogue-section">
      <div className="catalogue-section__header">
        <div className="catalogue-section__title-wrapper">
          {icon && <span className="catalogue-section__icon">{icon}</span>}
          <h2 className="catalogue-section__title">{title}</h2>
        </div>

        <div className="catalogue-section__nav">
          <button
            type="button"
            className="catalogue-section__nav-button"
            disabled={!canScrollPrev}
            onClick={() => emblaApi?.scrollPrev()}
          >
            <ChevronLeftIcon size={16} />
          </button>
          <button
            type="button"
            className="catalogue-section__nav-button"
            disabled={!canScrollNext}
            onClick={() => emblaApi?.scrollNext()}
          >
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </div>

      <div className="catalogue-section__viewport" ref={emblaRef}>
        <div className="catalogue-section__container">
          {isLoading ? (
            <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="catalogue-section__slide">
                  <Skeleton className="catalogue-section__card-skeleton" />
                </div>
              ))}
            </SkeletonTheme>
          ) : (
            games.map((game, index) => (
              <div key={game.objectId} className="catalogue-section__slide">
                <CatalogueSectionCard game={game} index={index} />
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
