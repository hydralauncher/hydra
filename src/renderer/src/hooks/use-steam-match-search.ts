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

const SEARCH_RESULT_LIMIT = 5;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

/**
 * Debounced search against Hydra's Steam catalogue, used to let a custom
 * game be matched to a real Steam AppID (for known-executable tracking and
 * more reliable SteamGridDB artwork lookups).
 */
export function useSteamMatchSearch(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<SteamMatchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Bumped on every query/enabled change so a response for a superseded
  // request (out-of-order completion, or one that resolves after matching
  // was disabled) can be told apart from the current one and discarded.
  const latestRequestId = useRef(0);

  const fetchSuggestions = useRef(
    debounce(async (searchQuery: string, requestId: number) => {
      try {
        const results = await window.electron.hydraApi.get<
          SteamMatchSuggestion[]
        >("/catalogue/search/suggestions", {
          params: {
            query: searchQuery,
            limit: SEARCH_RESULT_LIMIT,
            shop: "steam",
          },
          needsAuth: false,
        });

        if (requestId !== latestRequestId.current) return;
        setSuggestions(results);
      } catch (error) {
        if (requestId !== latestRequestId.current) return;
        logger.error("Failed to fetch Steam match suggestions", error);
        setSuggestions([]);
      } finally {
        if (requestId === latestRequestId.current) setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS)
  ).current;

  useEffect(() => {
    const trimmed = query.trim();
    const requestId = ++latestRequestId.current;

    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    fetchSuggestions(trimmed, requestId);
  }, [query, enabled, fetchSuggestions]);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  return { suggestions, isSearching, clearSuggestions };
}
