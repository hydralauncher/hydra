import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { TrendingGame } from "@types";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { ensureArray } from "@renderer/helpers";
import "./hero.scss";

// Featured game per language, kept for the session so returning to Home
// paints the hero at once instead of a skeleton.
const featuredCache = new Map<string, TrendingGame[]>();

export function Hero() {
  const { i18n } = useTranslation();
  const language = i18n.language.split("-")[0];

  const [featuredGameDetails, setFeaturedGameDetails] = useState<
    TrendingGame[] | null
  >(() => featuredCache.get(language) ?? null);
  // Start in the loading state: rendering nothing first and the skeleton a
  // tick later pushed the whole page down.
  const [isLoading, setIsLoading] = useState(
    () => !featuredCache.has(language)
  );

  const navigate = useNavigate();

  useEffect(() => {
    if (!featuredCache.has(language)) setIsLoading(true);

    window.electron.hydraApi
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((result) => {
        const featured = ensureArray<TrendingGame>(
          result,
          "/catalogue/featured"
        ).slice(0, 1);
        featuredCache.set(language, featured);
        setFeaturedGameDetails(featured);
      })
      .catch(() => {
        setFeaturedGameDetails([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [language]);

  if (isLoading) {
    return <Skeleton className="hero" />;
  }

  if (featuredGameDetails?.length) {
    return featuredGameDetails.map((game) => (
      <button
        type="button"
        onClick={() => navigate(game.uri)}
        className="hero"
        key={game.uri}
      >
        <div className="hero__backdrop">
          <img
            src={game.libraryHeroImageUrl ?? undefined}
            alt={game.description ?? ""}
            className="hero__media"
          />

          <div className="hero__content">
            <img
              src={game.logoImageUrl ?? undefined}
              width="250px"
              alt={game.description ?? ""}
              loading="eager"
              className="hero__logo"
            />
            <p className="hero__description">{game.description}</p>
          </div>
        </div>
      </button>
    ));
  }

  return null;
}
