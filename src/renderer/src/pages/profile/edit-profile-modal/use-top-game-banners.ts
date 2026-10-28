import { useEffect, useState } from "react";
import type { ArtworkItem, UserGame } from "@types";

const TOP_GAMES_COUNT = 6;

// Large, community-made heroes without nsfw, humor or flashing content. The
// API caches SteamGridDB, and the first result is the best scored one.
const HERO_FILTERS = {
  dimensions: "1920x620,3840x1240",
  nsfw: "false",
  humor: "false",
  epilepsy: "false",
  limit: "1",
};

// Animated first; static when the game has none; any style as a last resort.
const HERO_ATTEMPTS: Record<string, string>[] = [
  { ...HERO_FILTERS, types: "animated", styles: "alternate" },
  { ...HERO_FILTERS, types: "static", styles: "alternate" },
  { ...HERO_FILTERS, types: "static" },
];

export interface TopGameBanner {
  key: string;
  title: string;
  iconUrl: string | null;
  hero: ArtworkItem;
}

const findHero = async (game: UserGame) => {
  for (const parameters of HERO_ATTEMPTS) {
    const page = await window.electron
      .getGameArtwork(game.shop, game.objectId, "heroes", 0, parameters)
      .catch(() => null);
    const hero = page?.items[0];
    if (hero) return hero;
  }
  return null;
};

/** A SteamGridDB hero for each of the user's most played games. */
export function useTopGameBanners(userId: string | null) {
  const [banners, setBanners] = useState<TopGameBanner[]>([]);

  useEffect(() => {
    if (!userId) return;

    let isCancelled = false;
    (async () => {
      const response = await window.electron.hydraApi
        .get<{
          library: UserGame[];
          pinnedGames: UserGame[];
        }>(`/users/${userId}/library`, {
          params: { take: TOP_GAMES_COUNT, skip: 0, sortBy: "playtime" },
          needsAuth: false,
        })
        .catch(() => null);
      if (!response || isCancelled) return;

      // Pinned games come apart from the library list.
      const games = [
        ...new Map(
          [...response.library, ...response.pinnedGames].map((game) => [
            `${game.shop}:${game.objectId}`,
            game,
          ])
        ).values(),
      ]
        .filter((game) => game.playTimeInSeconds > 0)
        .sort((a, b) => b.playTimeInSeconds - a.playTimeInSeconds)
        .slice(0, TOP_GAMES_COUNT);

      const results = await Promise.all(
        games.map(async (game) => {
          const hero = await findHero(game);
          return hero
            ? {
                key: `${game.shop}:${game.objectId}`,
                title: game.title,
                iconUrl: game.customIconUrl ?? game.iconUrl ?? null,
                hero,
              }
            : null;
        })
      );

      if (!isCancelled) {
        setBanners(results.filter((banner) => banner !== null));
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [userId]);

  return banners;
}
