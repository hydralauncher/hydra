import { useState, useCallback, useEffect, useRef } from "react";
import { levelDBService } from "@renderer/services/leveldb.service";

export interface SearchHistoryEntry {
  query: string;
  timestamp: number;
  context: "library" | "catalogue";
}

const LEVELDB_KEY = "searchHistory";
const LEGACY_STORAGE_KEY = "search-history";
const MAX_HISTORY_ENTRIES = 15;

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const isInitialized = useRef(false);

  useEffect(() => {
    const loadHistory = async () => {
      if (isInitialized.current) return;
      isInitialized.current = true;

      try {
        let data = (await levelDBService.get(LEVELDB_KEY, null, "json")) as
          | SearchHistoryEntry[]
          | null;

        if (!data) {
          const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacyData) {
            try {
              const parsed = JSON.parse(legacyData) as SearchHistoryEntry[];
              await levelDBService.put(LEVELDB_KEY, parsed, null, "json");
              localStorage.removeItem(LEGACY_STORAGE_KEY);
              data = parsed;
            } catch {
              localStorage.removeItem(LEGACY_STORAGE_KEY);
            }
          }
        }

        if (data) {
          setHistory(data);
        }
      } catch {
        setHistory([]);
      }
    };

    loadHistory();
  }, []);

  const addToHistory = useCallback(
    (query: string, context: "library" | "catalogue") => {
      if (!query.trim()) return;

      const newEntry: SearchHistoryEntry = {
        query: query.trim(),
        timestamp: Date.now(),
        context,
      };

      setHistory((prev) => {
        const filtered = prev.filter(
          (entry) => entry.query.toLowerCase() !== query.toLowerCase().trim()
        );
        const updated = [newEntry, ...filtered].slice(0, MAX_HISTORY_ENTRIES);
        levelDBService.put(LEVELDB_KEY, updated, null, "json");
        return updated;
      });
    },
    []
  );

  const removeFromHistory = useCallback((query: string) => {
    setHistory((prev) => {
      const updated = prev.filter((entry) => entry.query !== query);
      levelDBService.put(LEVELDB_KEY, updated, null, "json");
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    levelDBService.del(LEVELDB_KEY, null);
  }, []);

  const getRecentHistory = useCallback(
    (context: "library" | "catalogue", limit: number = 3) => {
      return history
        .filter((entry) => entry.context === context)
        .slice(0, limit);
    },
    [history]
  );

  return {
    history,
    addToHistory,
    removeFromHistory,
    clearHistory,
    getRecentHistory,
  };
}
