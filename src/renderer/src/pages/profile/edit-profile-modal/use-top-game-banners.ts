import { useEffect, useState } from "react";
import type { ArtworkItem, UserGame } from "@types";
import { isVideoArtworkUrl } from "@renderer/hooks/game-artwork-utils";

export const TOP_GAMES_COUNT = 6;

// Large, community-made heroes without nsfw, humor or flashing content. The
// API caches SteamGridDB and sorts by score; a few candidates per attempt
// leave room to skip files that are too big.
const HERO_FILTERS = {
  dimensions: "1920x620,3840x1240",
  nsfw: "false",
  humor: "false",
  epilepsy: "false",
  limit: "5",
};

// Animated first, as WebP only: the banner crop keeps WebP animation but
// flattens animated PNGs. Then static; any style as a last resort.
const HERO_ATTEMPTS: Record<string, string>[] = [
  {
    ...HERO_FILTERS,
    types: "animated",
    styles: "alternate",
    mimes: "image/webp",
  },
  { ...HERO_FILTERS, types: "static", styles: "alternate" },
  { ...HERO_FILTERS, types: "static" },
];

// The artwork download and the API's banner upload both stop at 20 MB.
const MAX_HERO_SIZE_IN_BYTES = 20 * 1024 * 1024;

const fitsBannerSize = async (url: string) => {
  const response = await fetch(url, { method: "HEAD" }).catch(() => null);
  const length = Number(response?.headers.get("content-length"));
  return Number.isFinite(length) && length > 0
    ? length <= MAX_HERO_SIZE_IN_BYTES
    : false;
};

export interface TopGameBanner {
  key: string;
  title: string;
  iconUrl: string | null;
  playTimeInSeconds: number;
  hero: ArtworkItem;
  /** What the tile shows: small, and already decoded. */
  artUrl: string;
}

const findHero = async (game: UserGame): Promise<ArtworkItem | null> => {
  for (const parameters of HERO_ATTEMPTS) {
    const page = await window.electron
      .getGameArtwork(game.shop, game.objectId, "heroes", 0, parameters)
      .catch(() => null);
    const candidates = page?.items ?? [];
    const fits = await Promise.all(
      candidates.map((hero) => fitsBannerSize(hero.url))
    );
    const hero = candidates.find((_, index) => fits[index]);
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

// Chromium decodes animated WebPs frame by frame at full size, so animated
// heroes show as a small copy made in the main process. Static ones have a
// small `thumb` already.
const getArtUrl = async (hero: ArtworkItem) => {
  if (!isVideoArtworkUrl(hero.thumb)) return hero.thumb || hero.url;
  return (await window.electron.getBannerThumbnail(hero.url)) ?? hero.url;
};

// Keeps the decoded images alive, so the tiles paint them right away.
const decodedImages: HTMLImageElement[] = [];

const decodeImage = async (url: string) => {
  const image = new Image();
  image.src = url;
  await image.decode().catch(() => {});
  decodedImages.push(image);
};

const loadTopGameBanners = async (userId: string) => {
  const found: Omit<TopGameBanner, "artUrl">[] = [];
  const seen = new Set<string>();
  let skip = 0;

  // Games without a hero are skipped, so the next most played ones fill
  // the list, one library page at a time, until there are enough.
  while (found.length < TOP_GAMES_COUNT) {
    const page = await fetchLibraryPage(userId, skip);
    if (!page) return null;

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
              playTimeInSeconds: game.playTimeInSeconds,
              hero,
            }
          : null;
      })
    );

    found.push(...banners.filter((banner) => banner !== null));
    if (page.isLastPage) break;
    skip += TOP_GAMES_COUNT;
  }

  return Promise.all(
    found.slice(0, TOP_GAMES_COUNT).map(async (banner) => {
      const artUrl = await getArtUrl(banner.hero);
      await decodeImage(artUrl);
      return { ...banner, artUrl };
    })
  );
};

// One load per user and app session, shared by the profile and the modal.
const bannersByUser = new Map<string, TopGameBanner[]>();
const inflightLoads = new Map<string, Promise<TopGameBanner[] | null>>();

/** Starts loading the banners, or joins the load already running. */
export const preloadTopGameBanners = (userId: string) => {
  const existing = inflightLoads.get(userId);
  if (existing) return existing;

  const request = loadTopGameBanners(userId)
    .catch(() => null)
    .then((banners) => {
      // A failed load isn't kept, so the next profile visit tries again.
      if (banners) bannersByUser.set(userId, banners);
      inflightLoads.delete(userId);
      return banners;
    });

  inflightLoads.set(userId, request);
  return request;
};

/**
 * A SteamGridDB hero for each of the user's most played games, loaded and
 * decoded ahead of time: the own profile starts it, the edit modal shows it.
 */
export function useTopGameBanners(userId: string | null) {
  const [banners, setBanners] = useState<TopGameBanner[]>(
    () => (userId && bannersByUser.get(userId)) || []
  );
  const [isLoading, setIsLoading] = useState(
    () => !!userId && !bannersByUser.has(userId)
  );

  useEffect(() => {
    if (!userId) return;

    const cached = bannersByUser.get(userId);
    if (cached) {
      setBanners(cached);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    void preloadTopGameBanners(userId).then((loaded) => {
      if (isCancelled) return;
      setBanners(loaded ?? []);
      setIsLoading(false);
    });

    return () => {
      isCancelled = true;
    };
  }, [userId]);

  return { banners, isLoading };
}
