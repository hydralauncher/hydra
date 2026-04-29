import type { LibraryGame } from "@types";

export type LibraryFilterTab = "all" | "favorites" | "completed";
export type LibraryViewMode = "grid" | "list";
export type LibrarySortOption =
  | "last_played"
  | "playtime"
  | "title_asc"
  | "title_desc"
  | "added_desc"
  | "added_asc";
export type LibrarySecondaryFilter =
  | "all_games"
  | "installed"
  | "not_installed"
  | "never_played";

export const LIBRARY_VIEW_MODE_STORAGE_KEY =
  "hydra:big-picture:library-view-mode";
export const LIBRARY_SORT_BY_STORAGE_KEY =
  "hydra:big-picture:library-sort-by";
export const LIBRARY_SECONDARY_FILTER_STORAGE_KEY =
  "hydra:big-picture:library-filter-by";

export interface LibraryFilterCounts {
  all: number;
  favorites: number;
  completed: number;
}

export const LAST_PLAYED_GAMES_COUNT = 3;
const TITLE_COMPARE_OPTIONS = { sensitivity: "base" } as const;

function compareTitles(a: LibraryGame, b: LibraryGame) {
  return a.title.localeCompare(b.title, undefined, TITLE_COMPARE_OPTIONS);
}

function getDateTimestamp(value?: Date | string | null) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

export function sortByLastPlayed(a: LibraryGame, b: LibraryGame) {
  const aLastPlayed = getDateTimestamp(a.lastTimePlayed);
  const bLastPlayed = getDateTimestamp(b.lastTimePlayed);

  if (aLastPlayed !== null && bLastPlayed !== null) {
    const lastPlayedDifference = bLastPlayed - aLastPlayed;
    if (lastPlayedDifference !== 0) return lastPlayedDifference;
  }

  if (aLastPlayed !== null) return -1;
  if (bLastPlayed !== null) return 1;

  return compareTitles(a, b);
}

export function isCompletedGame(game: LibraryGame) {
  const achievementCount = game.achievementCount ?? 0;

  return (
    achievementCount > 0 &&
    (game.unlockedAchievementCount ?? 0) >= achievementCount
  );
}

export function matchesSearchQuery(game: LibraryGame, searchQuery: string) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const titleLower = game.title.toLowerCase();
  let queryIndex = 0;

  for (
    let titleIndex = 0;
    titleIndex < titleLower.length && queryIndex < normalizedQuery.length;
    titleIndex++
  ) {
    if (titleLower[titleIndex] === normalizedQuery[queryIndex]) queryIndex++;
  }

  return queryIndex === normalizedQuery.length;
}

export function filterLibraryByTab(
  library: LibraryGame[],
  selectedTab: LibraryFilterTab
) {
  if (selectedTab === "favorites") {
    return library.filter((game) => game.favorite);
  }

  if (selectedTab === "completed") {
    return library.filter(isCompletedGame);
  }

  return library;
}

export function getLibraryFilterCounts(
  library: LibraryGame[]
): LibraryFilterCounts {
  return {
    all: library.length,
    favorites: library.filter((game) => game.favorite).length,
    completed: library.filter(isCompletedGame).length,
  };
}

export function getLastPlayedGames(library: LibraryGame[]) {
  return library
    .filter((game) => game.lastTimePlayed != null)
    .slice(0, LAST_PLAYED_GAMES_COUNT);
}

export function filterLibraryBySecondaryFilter(
  library: LibraryGame[],
  selectedFilter: LibrarySecondaryFilter
) {
  if (selectedFilter === "installed") {
    return library.filter((game) => Boolean(game.executablePath));
  }

  if (selectedFilter === "not_installed") {
    return library.filter((game) => !game.executablePath);
  }

  if (selectedFilter === "never_played") {
    return library.filter((game) => (game.playTimeInMilliseconds ?? 0) <= 0);
  }

  return library;
}

export function sortLibraryGames(
  library: LibraryGame[],
  sortBy: LibrarySortOption
) {
  return [...library].sort((a, b) => {
    if (sortBy === "last_played") {
      return sortByLastPlayed(a, b);
    }

    if (sortBy === "playtime") {
      const playtimeDifference =
        (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0);

      return playtimeDifference !== 0 ? playtimeDifference : compareTitles(a, b);
    }

    if (sortBy === "title_asc") {
      return compareTitles(a, b);
    }

    if (sortBy === "title_desc") {
      return compareTitles(b, a);
    }

    if (sortBy === "added_desc" || sortBy === "added_asc") {
      const aAddedAt = getDateTimestamp(a.addedToLibraryAt);
      const bAddedAt = getDateTimestamp(b.addedToLibraryAt);

      if (aAddedAt !== null && bAddedAt !== null) {
        const addedDifference =
          sortBy === "added_desc"
            ? bAddedAt - aAddedAt
            : aAddedAt - bAddedAt;

        return addedDifference !== 0 ? addedDifference : compareTitles(a, b);
      }

      if (aAddedAt !== null) return -1;
      if (bAddedAt !== null) return 1;

      return compareTitles(a, b);
    }

    return compareTitles(a, b);
  });
}

export function getHeroPlaytimeLabel(playTimeInMilliseconds?: number | null) {
  if (!playTimeInMilliseconds) return "0h";

  const totalHours = Math.max(
    1,
    Math.round(playTimeInMilliseconds / 3_600_000)
  );

  return `${totalHours}h`;
}

export function isLibraryViewMode(
  value: string | null | undefined
): value is LibraryViewMode {
  return value === "grid" || value === "list";
}

export function isLibrarySortOption(
  value: string | null | undefined
): value is LibrarySortOption {
  return (
    value === "last_played" ||
    value === "playtime" ||
    value === "title_asc" ||
    value === "title_desc" ||
    value === "added_desc" ||
    value === "added_asc"
  );
}

export function isLibrarySecondaryFilter(
  value: string | null | undefined
): value is LibrarySecondaryFilter {
  return (
    value === "all_games" ||
    value === "installed" ||
    value === "not_installed" ||
    value === "never_played"
  );
}
