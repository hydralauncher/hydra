import { useState, useEffect, useCallback, useRef } from "react";
import { useAppSelector } from "./redux";
import { debounce } from "lodash-es";
import { logger } from "@renderer/logger";

export interface SearchSuggestion {
  title: string;
  objectId: string;
  shop: string;
  iconUrl: string | null;
  source: "library" | "catalogue";
}

export function useSearchSuggestions(
  query: string,
  isOnLibraryPage: boolean,
  enabled: boolean = true
) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const library = useAppSelector((state) => state.library.value);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, SearchSuggestion[]>>(new Map());

  const getLibrarySuggestions = useCallback(
    (searchQuery: string, limit: number = 3): SearchSuggestion[] => {
      if (!searchQuery.trim()) return [];

      const queryLower = searchQuery.toLowerCase();
      const matches: SearchSuggestion[] = [];

      for (const game of library) {
        if (matches.length >= limit) break;

        const titleLower = game.title.toLowerCase();
        let queryIndex = 0;

        for (
          let i = 0;
          i < titleLower.length && queryIndex < queryLower.length;
          i++
        ) {
          if (titleLower[i] === queryLower[queryIndex]) {
            queryIndex++;
          }
        }

        if (queryIndex === queryLower.length) {
          matches.push({
            title: game.title,
            objectId: game.objectId,
            shop: game.shop,
            iconUrl: game.iconUrl,
            source: "library",
          });
        }
      }

      return matches;
    },
    [library]
  );

  const fetchCatalogueSuggestions = useCallback(
    async (searchQuery: string, limit: number = 3) => {
      if (!searchQuery.trim() || searchQuery.length < 2) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }

      const cacheKey = `${searchQuery.toLowerCase()}_${limit}`;
      const cachedResults = cacheRef.current.get(cacheKey);

      if (cachedResults) {
        setSuggestions(cachedResults);
        setIsLoading(false);
        return;
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);

      try {
        const response = await window.electron.hydraApi.get<
          {
            title: string;
            objectId: string;
            shop: string;
            iconUrl: string | null;
          }[]
        >("/catalogue/search/suggestions", {
          params: {
            query: searchQuery,
            limit,
          },
          needsAuth: false,
        });

        if (abortController.signal.aborted) return;

        const catalogueSuggestions: SearchSuggestion[] = response.map(
          (item) => ({
            ...item,
            source: "catalogue" as const,
          })
        );

        cacheRef.current.set(cacheKey, catalogueSuggestions);
        setSuggestions(catalogueSuggestions);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setSuggestions([]);
          logger.error("Failed to fetch catalogue suggestions", error);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  const debouncedFetchCatalogue = useRef(
    debounce(fetchCatalogueSuggestions, 300)
  ).current;

  useEffect(() => {
    if (!enabled || !query || query.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      abortControllerRef.current?.abort();
      debouncedFetchCatalogue.cancel();
      return;
    }

    if (isOnLibraryPage) {
      const librarySuggestions = getLibrarySuggestions(query, 3);
      setSuggestions(librarySuggestions);
      setIsLoading(false);
    } else {
      debouncedFetchCatalogue(query, 3);
    }

    return () => {
      debouncedFetchCatalogue.cancel();
      abortControllerRef.current?.abort();
    };
  }, [
    query,
    isOnLibraryPage,
    enabled,
    getLibrarySuggestions,
    debouncedFetchCatalogue,
  ]);

  return { suggestions, isLoading };
}
