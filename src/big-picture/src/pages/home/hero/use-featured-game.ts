import type { TrendingGame } from "@types";
import { useEffect, useState } from "react";
import { IS_DESKTOP } from "../../../constants";
import { normalizeTrendingGame } from "../home-data";

export function useFeaturedGame() {
  const [featuredGame, setFeaturedGame] = useState<TrendingGame | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!IS_DESKTOP) {
      setFeaturedGame(null);
      return;
    }

    let isMounted = true;

    setIsLoading(true);

    globalThis.window.electron.hydraApi
      .get<unknown>("/catalogue/featured", {
        params: { language: "en" },
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
  }, []);

  return {
    featuredGame,
    isLoading,
  };
}
