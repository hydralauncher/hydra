import { useState, useCallback, useEffect } from "react";

export interface SearchHistoryEntry {
  query: string;
  timestamp: number;
  context: "library" | "catalogue";
}

const STORAGE_KEY = "search-history";
const MAX_HISTORY_ENTRIES = 15;

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as SearchHistoryEntry[];
        setHistory(parsed);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  const removeFromHistory = useCallback((query: string) => {
    setHistory((prev) => {
      const updated = prev.filter((entry) => entry.query !== query);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
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
