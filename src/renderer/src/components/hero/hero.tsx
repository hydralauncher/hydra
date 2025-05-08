import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { TrendingGame } from "@types";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import "./hero.scss";

export function Hero() {
  const [featuredGameDetails, setFeaturedGameDetails] = useState<
    TrendingGame[] | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);

  const { i18n } = useTranslation();

  const navigate = useNavigate();

  useEffect(() => {
    setIsLoading(true);

    window.electron
      .getTrendingGames()
      .then((result) => {
        setFeaturedGameDetails(result);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [i18n.language]);

  if (isLoading) {
    return <Skeleton className="hero" />;
  }

  if (featuredGameDetails?.length) {
    return featuredGameDetails.map((game, index) => (
      <button
        type="button"
        onClick={() => navigate(game.uri)}
        className="hero"
        key={index}
      >
        <div className="hero__backdrop">
          <img
            src={game.background}
            alt={game.description ?? ""}
            className="hero__media"
          />

          <div className="hero__content">
            {game.logo && (
              <img
                src={game.logo}
                width="250px"
                alt={game.description ?? ""}
                loading="eager"
              />
            )}
            <p className="hero__description">{game.description}</p>
          </div>
        </div>
      </button>
    ));
  }

  return null;
}
