import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import useEmblaCarousel from "embla-carousel-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";

import type { CatalogueSearchResult, GameShop, SteamGenre } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useSimilarGames } from "@renderer/hooks";
import {
  extractSimilarGameGenres,
  getSimilarGameCoverImageUrl,
} from "@renderer/hooks/similar-games";

import "./similar-games.scss";

const GAMES_PER_PAGE = 3;

interface SimilarGamesProps {
  objectId: string;
  shop: GameShop;
  genres?: SteamGenre[];
  platform?: string | null;
}

interface SimilarGameCardProps {
  game: CatalogueSearchResult;
  noDownloadsLabel: string;
  onClick: () => void;
}

function SimilarGameCard({
  game,
  noDownloadsLabel,
  onClick,
}: Readonly<SimilarGameCardProps>) {
  const primaryCoverImageUrl = getSimilarGameCoverImageUrl(game);
  const fallbackCoverImageUrl = game.libraryImageUrl;
  const [useFallbackCover, setUseFallbackCover] = useState(false);
  const coverImageUrl = useFallbackCover
    ? fallbackCoverImageUrl
    : primaryCoverImageUrl;

  useEffect(() => {
    setUseFallbackCover(false);
  }, [game.objectId, game.shop, primaryCoverImageUrl]);

  return (
    <button type="button" className="similar-games__card" onClick={onClick}>
      <div className="similar-games__cover">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={game.title}
            loading="lazy"
            onError={() => {
              if (
                !useFallbackCover &&
                fallbackCoverImageUrl &&
                fallbackCoverImageUrl !== primaryCoverImageUrl
              ) {
                setUseFallbackCover(true);
              }
            }}
          />
        ) : (
          <div className="similar-games__cover-placeholder" aria-hidden />
        )}
      </div>

      <div className="similar-games__card-content">
        <span className="similar-games__card-title">{game.title}</span>
        {game.downloadSources.length === 0 ? (
          <span className="similar-games__card-subtitle">
            {noDownloadsLabel}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function SimilarGamesSlide({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="similar-games__slide">{children}</div>;
}

export function SimilarGames({
  objectId,
  shop,
  genres = [],
  platform,
}: Readonly<SimilarGamesProps>) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("game_details");
  const { t: tGameCard } = useTranslation("game_card");
  const genreNames = useMemo(() => extractSimilarGameGenres(genres), [genres]);
  const { games, isLoading, isEligible } = useSimilarGames({
    objectId,
    shop,
    genres: genreNames,
    platform,
    language: i18n.resolvedLanguage ?? i18n.language ?? "en",
  });
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
    <section className="similar-games" aria-label={t("similar_games")}>
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
                    <SimilarGameCard
                      game={similarGame}
                      noDownloadsLabel={tGameCard("no_downloads")}
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
            aria-label="Previous"
            disabled={!canScrollPrev}
            onClick={() => emblaApi?.scrollPrev()}
          >
            <ChevronLeftIcon size={36} />
          </button>

          <button
            type="button"
            className="similar-games__control similar-games__control--next"
            aria-label="Next"
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
