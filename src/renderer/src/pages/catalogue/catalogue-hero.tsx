import { useEffect, useState, useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import type { TrendingGame } from "@types";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import cn from "classnames";

import "./catalogue-hero.scss";

export function CatalogueHero() {
  const [games, setGames] = useState<TrendingGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { i18n } = useTranslation();
  const navigate = useNavigate();

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true }, [
    Autoplay({ delay: 6000, stopOnInteraction: false, stopOnMouseEnter: true }),
  ]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    onSelect();

    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  useEffect(() => {
    const language = i18n.language.split("-")[0];

    window.electron.hydraApi
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((result) => {
        setGames(result.slice(0, 5));
      })
      .catch(() => {
        setGames([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [i18n.language]);

  if (isLoading) {
    return <Skeleton className="catalogue-hero__skeleton" />;
  }

  if (!games.length) return null;

  return (
    <div className="catalogue-hero">
      <div className="catalogue-hero__viewport" ref={emblaRef}>
        <div className="catalogue-hero__container">
          {games.map((game) => (
            <button
              key={game.uri}
              type="button"
              className="catalogue-hero__slide"
              onClick={() => navigate(game.uri)}
            >
              <img
                src={game.libraryHeroImageUrl ?? undefined}
                alt={game.title}
                className="catalogue-hero__image"
                loading="eager"
              />

              <div className="catalogue-hero__overlay" />

              <div className="catalogue-hero__content">
                {game.logoImageUrl ? (
                  <img
                    src={game.logoImageUrl}
                    alt={game.title}
                    className="catalogue-hero__logo"
                  />
                ) : (
                  <h2 className="catalogue-hero__title">{game.title}</h2>
                )}

                {game.description && (
                  <p className="catalogue-hero__description">
                    {game.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {games.length > 1 && (
        <div className="catalogue-hero__dots">
          {games.map((game, index) => (
            <button
              key={game.uri}
              type="button"
              className={cn("catalogue-hero__dot", {
                "catalogue-hero__dot--active": index === selectedIndex,
              })}
              onClick={() => emblaApi?.scrollTo(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
