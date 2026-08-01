import { useEffect, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import type { DownloadSource } from "@types";
import {
  fetchSimilarGames,
  type SimilarGame,
  type SimilarGamesGet,
  type SimilarGamesQuery,
} from "./similar-games";

export const useSimilarGames = (query: SimilarGamesQuery) => {
  const [games, setGames] = useState<SimilarGame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [resultQueryKey, setResultQueryKey] = useState("");
  const requestIdRef = useRef(0);
  const { objectId, shop } = query;
  const queryKey = `${shop}:${objectId}`;
  const isEligible =
    Boolean(objectId) && (shop === "steam" || shop === "launchbox");

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const stableQuery: SimilarGamesQuery = { objectId, shop };

    setGames([]);
    setResultQueryKey(queryKey);
    if (!isEligible) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const get: SimilarGamesGet = (path, options) =>
      globalThis.window.electron.hydraApi.get<unknown>(path, options);

    const loadSimilarGames = async () => {
      const sources = (await globalThis.window.electron.leveldb.values(
        "downloadSources"
      )) as DownloadSource[];

      if (requestId !== requestIdRef.current) return;

      const downloadSourceIds = [...sources]
        .sort(
          (first, second) =>
            new Date(second.createdAt).getTime() -
            new Date(first.createdAt).getTime()
        )
        .map((source) => source.id);
      const results = await fetchSimilarGames(
        stableQuery,
        get,
        downloadSourceIds
      );

      if (requestId === requestIdRef.current) setGames(results);
    };

    void loadSimilarGames()
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
  }, [isEligible, objectId, queryKey, shop]);

  const hasCurrentResults = resultQueryKey === queryKey;

  return {
    games: hasCurrentResults ? games : [],
    isLoading: isEligible && (!hasCurrentResults || isLoading),
    isEligible,
  };
};
