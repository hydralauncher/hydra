import { useState, useEffect, useRef } from "react";

const STEAMGRID_API_KEY = "8c53a8c366b96459117a44a68a5d7a60";
const cache = new Map<string, string | null>();

interface GridItem {
  width: number;
  height: number;
  url: string;
}

interface SearchResult {
  id: number;
}

async function safeFetchJson(url: string) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${STEAMGRID_API_KEY}` },
    });
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function fetchGridByObjectId(
  objectId: string,
  orientation: "vertical" | "horizontal" = "vertical"
): Promise<string | null> {
  const typeEndpoint = orientation === "horizontal" ? "heroes" : "grids";
  const data = await safeFetchJson(
    `https://www.steamgriddb.com/api/v2/${typeEndpoint}/steam/${objectId}`
  );

  if (data?.success && data.data?.length > 0) {
    if (orientation === "horizontal") {
      return (data.data[0] as GridItem).url;
    }

    const vertical =
      (data.data as GridItem[]).find(
        (g) => g.width === 600 && g.height === 900
      ) ?? (data.data[0] as GridItem);
    return vertical.url;
  }
  return null;
}

async function fetchGridByTitle(
  title: string,
  orientation: "vertical" | "horizontal" = "vertical"
): Promise<string | null> {
  // Try to clean up the title for better search results (e.g. remove TM, edition strings)
  const cleanTitle = title
    .replace(/™|®|©/g, "")
    .split(" - ")[0]
    .trim();

  const searchData = await safeFetchJson(
    `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleanTitle)}`
  );

  if (!searchData?.success || !searchData.data?.length) {
    if (cleanTitle !== title) {
      // fallback to original title if cleaned title failed
      const searchDataFallback = await safeFetchJson(
        `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`
      );
      if (!searchDataFallback?.success || !searchDataFallback.data?.length)
        return null;
      const gameId = (searchDataFallback.data[0] as SearchResult).id;
      return fetchGridByGameId(gameId, orientation);
    }
    return null;
  }

  const gameId = (searchData.data[0] as SearchResult).id;
  return fetchGridByGameId(gameId, orientation);
}

async function fetchGridByGameId(
  gameId: number,
  orientation: "vertical" | "horizontal"
): Promise<string | null> {
  const endpointUrl =
    orientation === "horizontal"
      ? `https://www.steamgriddb.com/api/v2/heroes/game/${gameId}`
      : `https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900`;

  const gridData = await safeFetchJson(endpointUrl);
  if (gridData?.success && gridData.data?.length > 0) {
    return (gridData.data[0] as GridItem).url;
  }

  // fallback if specific dimensions not found (mainly for vertical grids fallback)
  if (orientation === "vertical") {
    const fallbackData = await safeFetchJson(
      `https://www.steamgriddb.com/api/v2/grids/game/${gameId}`
    );
    if (fallbackData?.success && fallbackData.data?.length > 0) {
      return (fallbackData.data[0] as GridItem).url;
    }
  }

  return null;
}

export function useSteamGridCover(
  objectId: string,
  title: string,
  primaryFailed: boolean,
  orientation: "vertical" | "horizontal" = "vertical"
): string | null {
  const [gridUrl, setGridUrl] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!primaryFailed || fetchedRef.current) return;

    const cacheKey = `sgdb:${objectId}:${orientation}`;
    if (cache.has(cacheKey)) {
      setGridUrl(cache.get(cacheKey) ?? null);
      return;
    }

    fetchedRef.current = true;

    const run = async () => {
      let url = await fetchGridByObjectId(objectId, orientation);
      if (!url && title) url = await fetchGridByTitle(title, orientation);
      cache.set(cacheKey, url ?? null);
      setGridUrl(url ?? null);
    };

    run();
  }, [objectId, title, primaryFailed, orientation]);

  return gridUrl;
}

export interface SteamGridArt {
  heroUrl: string | null;
  logoUrl: string | null;
}

export function useSteamGridHeroAndLogo(
  objectId: string,
  title: string,
  primaryFailed: boolean
): SteamGridArt {
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!primaryFailed || fetchedRef.current) return;

    const cacheKeyHero = `sgdb:hero:${objectId}`;
    const cacheKeyLogo = `sgdb:logo:${objectId}`;

    if (cache.has(cacheKeyHero) && cache.has(cacheKeyLogo)) {
      setHeroUrl(cache.get(cacheKeyHero) ?? null);
      setLogoUrl(cache.get(cacheKeyLogo) ?? null);
      return;
    }

    fetchedRef.current = true;

    const run = async () => {
      let hero = await fetchGridByObjectId(objectId, "horizontal");
      if (!hero && title) hero = await fetchGridByTitle(title, "horizontal");

      let logo: string | null = null;
      const logoData = await safeFetchJson(
        `https://www.steamgriddb.com/api/v2/logos/steam/${objectId}`
      );

      if (logoData?.success && logoData.data?.length > 0) {
        logo = logoData.data[0].url;
      } else if (title) {
        // fallback by title for logo
        const cleanTitle = title
          .replace(/™|®|©/g, "")
          .split(" - ")[0]
          .trim();
        let searchData = await safeFetchJson(
          `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleanTitle)}`
        );

        if (!searchData?.success || !searchData.data?.length) {
          searchData = await safeFetchJson(
            `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(title)}`
          );
        }

        if (searchData?.success && searchData.data?.length) {
          const gameId = searchData.data[0].id;
          const fallbackLogoData = await safeFetchJson(
            `https://www.steamgriddb.com/api/v2/logos/game/${gameId}`
          );

          if (fallbackLogoData?.success && fallbackLogoData.data?.length > 0) {
            logo = fallbackLogoData.data[0].url;
          }
        }
      }

      cache.set(cacheKeyHero, hero ?? null);
      cache.set(cacheKeyLogo, logo ?? null);
      setHeroUrl(hero ?? null);
      setLogoUrl(logo ?? null);
    };

    run();
  }, [objectId, title, primaryFailed]);

  return { heroUrl, logoUrl };
}
