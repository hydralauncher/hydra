import { useEffect, useState } from "react";
import type { ArtworkItem, UserGame } from "@types";

export const TOP_GAMES_COUNT = 6;

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

const gameKey = (game: UserGame) => `${game.shop}:${game.objectId}`;

/**
 * One page of the profile library by playtime. Pinned games come apart from
 * the list, so they join the page whose playtime range they fall in.
 */
const fetchLibraryPage = async (userId: string, skip: number) => {
  const response = await window.electron.hydraApi
    .get<{
      library: UserGame[];
      pinnedGames: UserGame[];
    }>(`/users/${userId}/library`, {
      params: { take: TOP_GAMES_COUNT, skip, sortBy: "playtime" },
      needsAuth: false,
    })
    .catch(() => null);
  if (!response) return null;

  const isLastPage = response.library.length < TOP_GAMES_COUNT;
  const lowestPlaytime = isLastPage
    ? 0
    : (response.library.at(-1)?.playTimeInSeconds ?? 0);
  const pinned = response.pinnedGames.filter(
    (game) => game.playTimeInSeconds >= lowestPlaytime
  );

  return {
    isLastPage,
    // Unplayed games still count: they fill the list when needed.
    games: [...response.library, ...pinned].sort(
      (a, b) => b.playTimeInSeconds - a.playTimeInSeconds
    ),
  };
};

/** A SteamGridDB hero for each of the user's most played games. */
export function useTopGameBanners(userId: string | null) {
  const [banners, setBanners] = useState<TopGameBanner[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;

    let isCancelled = false;
    setIsLoading(true);
    void (async () => {
      const found: TopGameBanner[] = [];
      const seen = new Set<string>();
      let skip = 0;

      // Games without a hero are skipped, so the next most played ones fill
      // the list, one library page at a time, until there are enough.
      while (found.length < TOP_GAMES_COUNT) {
        const page = await fetchLibraryPage(userId, skip);
        if (!page || isCancelled) return;

        const games = page.games.filter((game) => {
          const key = gameKey(game);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const banners = await Promise.all(
          games.map(async (game) => {
            const hero = await findHero(game);
            return hero
              ? {
                  key: gameKey(game),
                  title: game.title,
                  iconUrl: game.customIconUrl ?? game.iconUrl ?? null,
                  hero,
                }
              : null;
          })
        );
        if (isCancelled) return;

        found.push(...banners.filter((banner) => banner !== null));
        if (page.isLastPage) break;
        skip += TOP_GAMES_COUNT;
      }

      setBanners(found.slice(0, TOP_GAMES_COUNT));
    })().finally(() => {
      if (!isCancelled) setIsLoading(false);
    });

    return () => {
      isCancelled = true;
    };
  }, [userId]);

  return { banners, isLoading };
}
