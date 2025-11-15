import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { TrendingGame } from "@types";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { stripHtml } from "@shared";
import "./hero.scss";

const decodeHtmlEntities = (value: string) => {
  if (!value) return "";

  try {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  } catch {
    return value;
  }
};

export function Hero() {
  const [featuredGameDetails, setFeaturedGameDetails] = useState<
    TrendingGame[] | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);

  const { i18n } = useTranslation();

  const navigate = useNavigate();

  useEffect(() => {
    setIsLoading(true);

    const language = i18n.language.split("-")[0];

    window.electron.hydraApi
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((result) => {
        setFeaturedGameDetails(result.slice(0, 1));
      })
      .catch(() => {
        setFeaturedGameDetails([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [i18n.language]);

  if (isLoading) {
    return <Skeleton className="hero" />;
  }

  if (featuredGameDetails?.length) {
    return featuredGameDetails.map((game) => {
      const decodedDescription = decodeHtmlEntities(game.description ?? "");
      const description = stripHtml(decodedDescription);

      return (
        <button
          type="button"
          onClick={() => navigate(game.uri)}
          className="hero"
          key={game.uri}
        >
          <div className="hero__backdrop">
            <img
              src={game.libraryHeroImageUrl ?? undefined}
              alt={description}
              className="hero__media"
            />

            <div className="hero__content">
              <img
                src={game.logoImageUrl ?? undefined}
                width="250px"
                alt={description}
                loading="eager"
                className="hero__logo"
              />
              <p className="hero__description">{description}</p>
            </div>
          </div>
        </button>
      );
    });
  }

  return null;
}
