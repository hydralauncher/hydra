import type { LibraryGame } from "@types";
import { groupLibraryGames } from "@shared";
import { useDeferredValue, useMemo } from "react";
import { useBigPictureRunningGames } from "../../../hooks/use-big-picture-running-games.hook";
import {
  getFirstLibraryFocusGridItemId,
  getFirstLibraryFocusListItemId,
} from "./navigation";
import {
  filterLibraryByTab,
  filterLibraryBySecondaryFilter,
  getLastPlayedGames,
  getLibraryFilterCounts,
  matchesSearchQuery,
  sortByLastPlayed,
  sortLibraryGames,
  type LibraryFilterTab,
  type LibrarySecondaryFilter,
  type LibrarySortOption,
} from "./library-data";

export function useLibraryPageData(
  library: LibraryGame[],
  selectedTab: LibraryFilterTab,
  search: string,
  sortBy: LibrarySortOption,
  secondaryFilter: LibrarySecondaryFilter
) {
  const deferredSearch = useDeferredValue(search);
  const runningGames = useBigPictureRunningGames();
  const groupedLibrary = useMemo(
    () => groupLibraryGames(library, Object.keys(runningGames)),
    [library, runningGames]
  );

  const lastPlayedSortedLibrary = useMemo(() => {
    return [...groupedLibrary].sort(sortByLastPlayed);
  }, [groupedLibrary]);

  const filteredLibrary = useMemo(() => {
    const tabFilteredLibrary = filterLibraryByTab(groupedLibrary, selectedTab);
    const secondaryFilteredLibrary = filterLibraryBySecondaryFilter(
      tabFilteredLibrary,
      secondaryFilter
    );
    const searchFilteredLibrary = secondaryFilteredLibrary.filter((game) =>
      matchesSearchQuery(game, deferredSearch)
    );

    return sortLibraryGames(searchFilteredLibrary, sortBy);
  }, [deferredSearch, groupedLibrary, secondaryFilter, selectedTab, sortBy]);

  const filterCounts = useMemo(() => {
    return getLibraryFilterCounts(groupedLibrary);
  }, [groupedLibrary]);

  const lastPlayedGames = useMemo(() => {
    return getLastPlayedGames(lastPlayedSortedLibrary);
  }, [lastPlayedSortedLibrary]);

  const firstGridItemId = useMemo(() => {
    return getFirstLibraryFocusGridItemId(filteredLibrary[0]?.id);
  }, [filteredLibrary]);

  const firstListItemId = useMemo(() => {
    return getFirstLibraryFocusListItemId(filteredLibrary[0]?.id);
  }, [filteredLibrary]);

  return {
    groupedLibrary,
    filteredLibrary,
    filterCounts,
    firstGridItemId,
    firstListItemId,
    lastPlayedGames,
  };
}
