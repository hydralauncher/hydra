import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import type { CatalogueSearchResult } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";
import "./featured-carousel.scss";

interface FeaturedCarouselProps {
  games: CatalogueSearchResult[];
}

const SLIDE_INTERVAL = 10000;

const getHeroUrl = (game: CatalogueSearchResult): string =>
  `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/library_600x900_2x.jpg`;

function SlideImage({ game }: { game: CatalogueSearchResult }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? (game.libraryImageUrl ?? "") : getHeroUrl(game);
  return (
    <img
      src={src}
      alt={game.title}
      className="featured-carousel__img"
      loading="lazy"
      onError={() => !failed && setFailed(true)}
    />
  );
}

export function FeaturedCarousel({ games }: Readonly<FeaturedCarouselProps>) {
  const [active, setActive] = useState(0);
  const navigate = useNavigate();

  const slideTo = useCallback(
    (index: number) => {
      setActive((index + games.length) % games.length);
    },
    [games.length]
  );

  useEffect(() => {
    if (games.length <= 1) return;
    const id = setInterval(() => slideTo(active + 1), SLIDE_INTERVAL);
    return () => clearInterval(id);
  }, [active, games.length, slideTo]);

  if (!games.length) return null;

  const prev = (active - 1 + games.length) % games.length;
  const next = (active + 1) % games.length;

  const displayedSlots =
    games.length >= 3
      ? [
          { game: games[prev], slot: "prev" as const },
          { game: games[active], slot: "main" as const },
          { game: games[next], slot: "next" as const },
        ]
      : [{ game: games[0], slot: "main" as const }];

  return (
    <div className="featured-carousel" aria-label="Jogos em destaque">
      <button
        type="button"
        className="featured-carousel__nav featured-carousel__nav--left"
        onClick={() => slideTo(active - 1)}
        aria-label="Anterior"
      >
        <ChevronLeftIcon size={24} />
      </button>

      <div className="featured-carousel__track">
        {displayedSlots.map(({ game, slot }) => (
          <button
            key={`${slot}-${game.objectId}`}
            type="button"
            className={`featured-carousel__slide featured-carousel__slide--${slot}`}
            onClick={() => navigate(buildGameDetailsPath(game))}
            aria-label={game.title}
          >
            <SlideImage game={game} />
            <div className="featured-carousel__overlay" />
            <div className="featured-carousel__info">
              <h3 className="featured-carousel__title">{game.title}</h3>
              {game.genres?.length > 0 && (
                <div className="featured-carousel__genres">
                  {game.genres.slice(0, 3).join(", ")}
                </div>
              )}
              {game.downloadSources?.length > 0 && (
                <div className="featured-carousel__sources">
                  {game.downloadSources.slice(0, 2).map((s) => (
                    <span key={s} className="featured-carousel__source-badge">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="featured-carousel__nav featured-carousel__nav--right"
        onClick={() => slideTo(active + 1)}
        aria-label="Próximo"
      >
        <ChevronRightIcon size={24} />
      </button>

      <div className="featured-carousel__dots">
        {games.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`featured-carousel__dot${i === active ? " featured-carousel__dot--active" : ""}`}
            onClick={() => slideTo(i)}
            aria-label={`Slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
