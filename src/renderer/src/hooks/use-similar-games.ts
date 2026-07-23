import axios from "axios";
import { useEffect, useRef, useState } from "react";

import type { CatalogueSearchResult } from "@types";
import { logger } from "@renderer/logger";
import {
  fetchSimilarGames,
  type GenresByLanguage,
  type SimilarGamesQuery,
  type SimilarGamesSearch,
} from "./similar-games";

let genreMetadataPromise: Promise<GenresByLanguage> | null = null;

const getSteamGenres = () => {
  if (!genreMetadataPromise) {
    genreMetadataPromise = axios
      .get<GenresByLanguage>(
        `${import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL}/steam-genres.json`
      )
      .then((response) => response.data)
      .catch((error) => {
        genreMetadataPromise = null;
        throw error;
      });
  }

  return genreMetadataPromise;
};

export const useSimilarGames = (query: SimilarGamesQuery) => {
  const [games, setGames] = useState<CatalogueSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [resultQueryKey, setResultQueryKey] = useState("");
  const requestIdRef = useRef(0);
  const { objectId, shop, platform, language } = query;
  const genreKey = query.genres.join("\u0000");
  const queryKey = JSON.stringify([
    objectId,
    shop,
    platform ?? null,
    language,
    genreKey,
  ]);
  const isEligible = shop !== "custom" && genreKey.length > 0;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const stableQuery: SimilarGamesQuery = {
      objectId,
      shop,
      platform,
      language,
      genres: genreKey ? genreKey.split("\u0000") : [],
    };
    const canSearch =
      stableQuery.shop !== "custom" && stableQuery.genres.length > 0;

    setGames([]);
    setResultQueryKey(queryKey);
    if (!canSearch) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const search: SimilarGamesSearch = (payload) =>
      globalThis.window.electron.hydraApi.post("/catalogue/search", {
        data: payload,
        needsAuth: false,
      });

    const genresPromise =
      stableQuery.shop === "steam"
        ? getSteamGenres()
        : Promise.resolve(undefined);

    genresPromise
      .then((genresByLanguage) =>
        fetchSimilarGames(stableQuery, search, genresByLanguage)
      )
      .then((results) => {
        if (requestId === requestIdRef.current) setGames(results);
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        logger.error("Failed to fetch similar games", error);
        setGames([]);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [genreKey, language, objectId, platform, queryKey, shop]);

  const hasCurrentResults = resultQueryKey === queryKey;

  return {
    games: hasCurrentResults ? games : [],
    isLoading: isEligible && (!hasCurrentResults || isLoading),
    isEligible,
  };
};
