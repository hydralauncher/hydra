import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";

import type { GameShop } from "@types";
import { VerticalCoverCard } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useSimilarGames } from "@renderer/hooks";

import "./similar-games.scss";

const GAMES_PER_PAGE = 3;

interface SimilarGamesProps {
  objectId: string;
  shop: GameShop;
}

function SimilarGamesSlide({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="similar-games__slide">{children}</div>;
}

export function SimilarGames({ objectId, shop }: Readonly<SimilarGamesProps>) {
  const navigate = useNavigate();
  const { t } = useTranslation("game_details");
  const { games, isLoading, isEligible } = useSimilarGames({ objectId, shop });
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: GAMES_PER_PAGE,
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

  if (!isEligible || (!isLoading && games.length === 0)) return null;

  return (
    <section className="similar-games">
      <h2 className="similar-games__title">{t("similar_games")}</h2>

      <div className="similar-games__carousel">
        <div className="similar-games__viewport" ref={emblaRef}>
          <div className="similar-games__container">
            {isLoading
              ? Array.from({ length: GAMES_PER_PAGE }, (_, index) => (
                  <SimilarGamesSlide key={`similar-game-skeleton-${index}`}>
                    <Skeleton className="similar-games__skeleton" />
                  </SimilarGamesSlide>
                ))
              : games.map((similarGame) => (
                  <SimilarGamesSlide
                    key={`${similarGame.shop}:${similarGame.objectId}`}
                  >
                    <VerticalCoverCard
                      gameTitle={similarGame.title}
                      coverImageUrls={[
                        similarGame.coverImageUrl,
                        similarGame.libraryImageUrl,
                        similarGame.iconUrl,
                      ]}
                      useClassicsLayout={similarGame.shop === "launchbox"}
                      onClick={() =>
                        navigate(buildGameDetailsPath(similarGame))
                      }
                    />
                  </SimilarGamesSlide>
                ))}
          </div>

          <button
            type="button"
            className="similar-games__control similar-games__control--previous"
            aria-label={t("previous_media")}
            disabled={!canScrollPrev}
            onClick={() => emblaApi?.scrollPrev()}
          >
            <ChevronLeftIcon size={36} />
          </button>

          <button
            type="button"
            className="similar-games__control similar-games__control--next"
            aria-label={t("next_media")}
            disabled={!canScrollNext}
            onClick={() => emblaApi?.scrollNext()}
          >
            <ChevronRightIcon size={36} />
          </button>
        </div>
      </div>
    </section>
  );
}
