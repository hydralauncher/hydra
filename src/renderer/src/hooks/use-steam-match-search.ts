import { useCallback, useEffect, useRef, useState } from "react";
import { debounce } from "lodash-es";
import { logger } from "@renderer/logger";
import type { GameShop } from "@types";

export interface SteamMatchSuggestion {
  title: string;
  objectId: string;
  shop: GameShop;
  iconUrl: string | null;
}

/**
 * Debounced search against Hydra's Steam catalogue, used to let a custom
 * game be matched to a real Steam AppID (for known-executable tracking and
 * more reliable SteamGridDB artwork lookups).
 */
export function useSteamMatchSearch(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<SteamMatchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Tracks the most recently *started* request so an earlier request that
  // resolves after a later one can't overwrite fresher suggestions.
  const latestQueryRef = useRef<string | null>(null);

  const fetchSuggestions = useRef(
    debounce(async (searchQuery: string) => {
      latestQueryRef.current = searchQuery;

      try {
        const results = await window.electron.hydraApi.get<
          SteamMatchSuggestion[]
        >("/catalogue/search/suggestions", {
          params: { query: searchQuery, limit: 5, shop: "steam" },
          needsAuth: false,
        });

        if (latestQueryRef.current !== searchQuery) return;
        setSuggestions(results);
      } catch (error) {
        if (latestQueryRef.current !== searchQuery) return;
        logger.error("Failed to fetch Steam match suggestions", error);
        setSuggestions([]);
      } finally {
        if (latestQueryRef.current === searchQuery) {
          setIsSearching(false);
        }
      }
    }, 350)
  ).current;

  useEffect(() => {
    const trimmed = query.trim();

    if (!enabled || trimmed.length < 2) {
      latestQueryRef.current = null;
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    fetchSuggestions(trimmed);
  }, [query, enabled, fetchSuggestions]);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  return { suggestions, isSearching, clearSuggestions };
}
