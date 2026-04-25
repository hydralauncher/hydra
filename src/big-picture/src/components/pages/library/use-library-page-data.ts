import type { LibraryGame } from "@types";
import { useDeferredValue, useMemo } from "react";
import { getFirstLibraryFocusGridItemId } from "./navigation";
import {
  filterLibraryByTab,
  getLastPlayedGames,
  getLibraryFilterCounts,
  matchesSearchQuery,
  sortByLastPlayed,
  type LibraryFilterTab,
} from "./library-data";

export function useLibraryPageData(
  library: LibraryGame[],
  selectedTab: LibraryFilterTab,
  search: string
) {
  const deferredSearch = useDeferredValue(search);

  const sortedLibrary = useMemo(() => {
    return [...library].sort(sortByLastPlayed);
  }, [library]);

  const filteredLibrary = useMemo(() => {
    return filterLibraryByTab(sortedLibrary, selectedTab).filter((game) =>
      matchesSearchQuery(game, deferredSearch)
    );
  }, [deferredSearch, selectedTab, sortedLibrary]);

  const filterCounts = useMemo(() => {
    return getLibraryFilterCounts(library);
  }, [library]);

  const lastPlayedGames = useMemo(() => {
    return getLastPlayedGames(sortedLibrary);
  }, [sortedLibrary]);

  const firstGridItemId = useMemo(() => {
    return getFirstLibraryFocusGridItemId(filteredLibrary[0]?.id);
  }, [filteredLibrary]);

  return {
    filteredLibrary,
    filterCounts,
    firstGridItemId,
    lastPlayedGames,
  };
}
