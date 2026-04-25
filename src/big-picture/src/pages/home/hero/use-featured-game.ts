import type { TrendingGame } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IS_DESKTOP } from "../../../constants";

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
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((games) => {
        if (!isMounted) return;

        setFeaturedGame(games[0] ?? null);
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
