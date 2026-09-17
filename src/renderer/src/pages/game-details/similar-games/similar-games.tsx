import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@primer/octicons-react";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";

import type { GameShop } from "@types";
import { VerticalCoverCard } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useSimilarGames } from "@renderer/hooks";
import {
  getSimilarGamesSectionState,
  type SimilarGame,
} from "@renderer/hooks/similar-games";
import {
  readSimilarGamesCollapsed,
  storeSimilarGamesCollapsed,
} from "./similar-games-collapsed";

import "./similar-games.scss";

const SKELETON_COUNT = 5;

interface SimilarGamesProps {
  objectId: string;
  shop: GameShop;
}

function SimilarGamesSkeleton() {
  return (
    <div className="similar-games__rail" aria-busy="true">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div
          key={`similar-game-skeleton-${index}`}
          className="similar-games__slide"
        >
          <Skeleton className="similar-games__skeleton-cover" />
          <div className="similar-games__caption">
            <Skeleton className="similar-games__skeleton-title" />
            <Skeleton className="similar-games__skeleton-sources" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface SimilarGameCardProps {
  game: SimilarGame;
  onOpen: () => void;
}

function SimilarGameCard({ game, onOpen }: Readonly<SimilarGameCardProps>) {
  const { t } = useTranslation("game_details");
  const sourceCount = game.downloadSources.length;

  return (
    <div className="similar-games__slide">
      <VerticalCoverCard
        className="similar-games__cover"
        gameTitle={game.title}
        coverImageUrls={[
          game.coverImageUrl,
          game.libraryImageUrl,
          game.iconUrl,
        ]}
        useClassicsLayout={game.shop === "launchbox"}
        showTitleTooltip={false}
        onClick={onOpen}
      />

      <button
        type="button"
        className="similar-games__caption"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onOpen}
      >
        <span className="similar-games__game-title">{game.title}</span>
        <span
          className={`similar-games__sources${
            sourceCount === 0 ? " similar-games__sources--none" : ""
          }`}
        >
          {sourceCount === 0
            ? t("similar_game_no_sources")
            : t("similar_game_sources", { count: sourceCount })}
        </span>
      </button>
    </div>
  );
}

export function SimilarGames({ objectId, shop }: Readonly<SimilarGamesProps>) {
  const navigate = useNavigate();
  const { t } = useTranslation("game_details");
  const { games, isLoading, isEligible } = useSimilarGames({ objectId, shop });
  const sectionState = getSimilarGamesSectionState(
    isEligible,
    isLoading,
    games.length
  );
  const [isCollapsed, setIsCollapsed] = useState(() =>
    readSimilarGamesCollapsed()
  );
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: "auto",
    duration: 20,
  });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const syncControls = useCallback(() => {
    setCanScrollPrev(emblaApi?.canScrollPrev() ?? false);
    setCanScrollNext(emblaApi?.canScrollNext() ?? false);
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;

    syncControls();
    emblaApi.on("select", syncControls);
    emblaApi.on("reInit", syncControls);

    return () => {
      emblaApi.off("select", syncControls);
      emblaApi.off("reInit", syncControls);
    };
  }, [emblaApi, syncControls]);

  useEffect(() => {
    emblaApi?.scrollTo(0, true);
  }, [emblaApi, objectId, shop]);

  const toggleCollapsed = () => {
    setIsCollapsed((current) => {
      const next = !current;
      storeSimilarGamesCollapsed(next);
      return next;
    });
  };

  if (sectionState === "hidden") return null;

  const isReady = sectionState === "ready";
  const showPager = isReady && !isCollapsed && games.length > 1;

  return (
    <section
      className={`similar-games${isCollapsed ? " similar-games--collapsed" : ""}`}
    >
      <div className="similar-games__header">
        <h2 className="similar-games__title">
          <button
            type="button"
            className="similar-games__toggle"
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? t("expand_similar_games")
                : t("collapse_similar_games")
            }
            onClick={toggleCollapsed}
          >
            <ChevronDownIcon
              size={16}
              className={`similar-games__chevron${
                isCollapsed ? "" : " similar-games__chevron--open"
              }`}
            />
            <span>{t("similar_games")}</span>
          </button>
        </h2>

        {isReady ? (
          <span className="similar-games__badge">{games.length}</span>
        ) : null}

        {showPager ? (
          <div className="similar-games__pager">
            <button
              type="button"
              className="similar-games__pager-button"
              aria-label={t("previous_media")}
              disabled={!canScrollPrev}
              onClick={() => emblaApi?.scrollPrev()}
            >
              <ChevronLeftIcon size={16} />
            </button>

            <button
              type="button"
              className="similar-games__pager-button"
              aria-label={t("next_media")}
              disabled={!canScrollNext}
              onClick={() => emblaApi?.scrollNext()}
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        ) : null}
      </div>

      {isCollapsed ? null : (
        <div className="similar-games__content">
          {sectionState === "loading" ? <SimilarGamesSkeleton /> : null}

          {sectionState === "empty" ? (
            <div className="similar-games__empty" role="status">
              <span className="similar-games__empty-dot" aria-hidden="true" />
              {t("no_similar_games")}
            </div>
          ) : null}

          {isReady ? (
            <div
              className={[
                "similar-games__viewport",
                canScrollPrev ? "similar-games__viewport--fade-start" : "",
                canScrollNext ? "similar-games__viewport--fade-end" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="similar-games__scroller" ref={emblaRef}>
                <div className="similar-games__rail">
                  {games.map((similarGame) => (
                    <SimilarGameCard
                      key={`${similarGame.shop}:${similarGame.objectId}`}
                      game={similarGame}
                      onOpen={() => navigate(buildGameDetailsPath(similarGame))}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
