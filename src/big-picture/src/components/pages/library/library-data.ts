import type { LibraryGame } from "@types";

export type LibraryFilterTab = "all" | "favorites" | "completed";

export interface LibraryFilterCounts {
  all: number;
  favorites: number;
  completed: number;
}

export const LAST_PLAYED_GAMES_COUNT = 3;

export function sortByLastPlayed(a: LibraryGame, b: LibraryGame) {
  const aLastPlayed = a.lastTimePlayed
    ? new Date(a.lastTimePlayed as Date).getTime()
    : null;
  const bLastPlayed = b.lastTimePlayed
    ? new Date(b.lastTimePlayed as Date).getTime()
    : null;

  if (aLastPlayed !== null && bLastPlayed !== null) {
    const lastPlayedDifference = bLastPlayed - aLastPlayed;
    if (lastPlayedDifference !== 0) return lastPlayedDifference;
  }

  if (aLastPlayed !== null) return -1;
  if (bLastPlayed !== null) return 1;

  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
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

export function getHeroPlaytimeLabel(playTimeInMilliseconds?: number | null) {
  if (!playTimeInMilliseconds) return "0h";

  const totalHours = Math.max(
    1,
    Math.round(playTimeInMilliseconds / 3_600_000)
  );

  return `${totalHours}h`;
}
