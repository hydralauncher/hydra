import type { TrendingGame } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IS_DESKTOP } from "../../../constants";
import { normalizeTrendingGame } from "../home-data";

export function useFeaturedGame() {
  const [featuredGame, setFeaturedGame] = useState<TrendingGame | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!IS_DESKTOP) {
      setFeaturedGame(null);
      return;
    }

    let isMounted = true;
    const language = i18n.language.split("-")[0];

    setIsLoading(true);

    globalThis.window.electron.hydraApi
      .get<unknown>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((response) => {
        if (!isMounted) return;

        const games = Array.isArray(response) ? response : [];

        setFeaturedGame(normalizeTrendingGame(games[0]));
      })
      .catch(() => {
        if (!isMounted) return;

        setFeaturedGame(null);
      })
      .finally(() => {
        if (!isMounted) return;

        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [i18n.language]);

  return {
    featuredGame,
    isLoading,
  };
}
