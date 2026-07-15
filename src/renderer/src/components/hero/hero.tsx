import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import type { ShopAssets } from "@types";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { buildGameDetailsPath } from "@renderer/helpers";
import "./hero.scss";

const AUTOPLAY_DELAY = 7000;

interface HeroProps {
  games: ShopAssets[];
  isLoading: boolean;
}

export function Hero({ games, isLoading }: HeroProps) {
  const [featuredGames, setFeaturedGames] = useState<ShopAssets[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { t } = useTranslation("home");

  const navigate = useNavigate();

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, align: "start" },
    [
      Autoplay({
        delay: AUTOPLAY_DELAY,
        stopOnInteraction: false,
      }),
    ]
  );

  useEffect(() => {
    setFeaturedGames(games.slice(0, 8));
  }, [games]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  const scrollPrev = useCallback(() => {
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const scrollTo = useCallback(
    (index: number) => {
      emblaApi?.scrollTo(index);
    },
    [emblaApi]
  );

  const handleMouseEnter = useCallback(() => {
    emblaApi?.plugins().autoplay?.stop();
  }, [emblaApi]);

  const handleMouseLeave = useCallback(() => {
    emblaApi?.plugins().autoplay?.play();
  }, [emblaApi]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!emblaApi) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        emblaApi.scrollPrev();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        emblaApi.scrollNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [emblaApi]);

  if (isLoading) {
    return <Skeleton className="hero" />;
  }

  if (featuredGames.length === 0) {
    return null;
  }

  return (
    <div
      className="hero hero--carousel"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="hero__viewport" ref={emblaRef}>
        <div className="hero__container">
          {featuredGames.map((game) => (
            <button
              type="button"
              onClick={() => navigate(buildGameDetailsPath(game))}
              className="hero__slide"
              key={game.objectId}
            >
              <div className="hero__backdrop">
                <img
                  src={
                    game.libraryHeroImageUrl ??
                    game.libraryImageUrl ??
                    undefined
                  }
                  alt={game.title ?? ""}
                  className="hero__media"
                />

                <div className="hero__content">
                  <img
                    src={game.logoImageUrl ?? undefined}
                    width="250px"
                    alt={game.title ?? ""}
                    loading="eager"
                    className="hero__logo"
                  />
                  <p className="hero__description">{game.title}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {featuredGames.length > 1 && (
        <>
          <button
            type="button"
            className="hero__nav hero__nav--prev"
            onClick={scrollPrev}
            aria-label={t("previous_slide")}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10 12L6 8L10 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="hero__nav hero__nav--next"
            onClick={scrollNext}
            aria-label={t("next_slide")}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 4L10 8L6 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            className="hero__dots"
            role="tablist"
            aria-label={
              t("go_to_slide", { index: "" }).replace("1", "").trim() ||
              "Slides"
            }
          >
            {featuredGames.map((game, index) => (
              <button
                type="button"
                key={game.objectId}
                className={`hero__dot${index === selectedIndex ? " hero__dot--active" : ""}`}
                onClick={() => scrollTo(index)}
                role="tab"
                aria-selected={index === selectedIndex}
                aria-label={t("go_to_slide", { index: index + 1 })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
