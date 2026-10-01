export type LibraryCategory = "all" | "pc" | "classics";

export type LibrarySource = "hydra" | "steam";

export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  "all",
  "pc",
  "classics",
];

export const LIBRARY_SOURCES: readonly LibrarySource[] = ["hydra", "steam"];

export const LEGACY_STEAM_LIBRARY_CATEGORY = "steam_library";

export interface LibraryCategoryGame {
  shop: string;
  hasActiveSteamImport?: boolean;
}

export interface LibraryFilterGame extends LibraryCategoryGame {
  platform?: string | null;
}

export interface LibraryGameFilters {
  category: LibraryCategory;
  sources: string[];
  platforms: string[];
}

export interface ProfileLibraryFilter {
  shops: string[];
}

export const isLibraryCategory = (value: unknown): value is LibraryCategory =>
  LIBRARY_CATEGORIES.includes(value as LibraryCategory);

export const isLibrarySource = (value: unknown): value is LibrarySource =>
  LIBRARY_SOURCES.includes(value as LibrarySource);

export const parseStoredLibrarySources = (
  value: string | null
): LibrarySource[] => {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    const sources = LIBRARY_SOURCES.filter((source) => parsed.includes(source));
    return sources.length === 1 ? sources : [];
  } catch {
    return [];
  }
};

export const resolveStoredLibraryCategory = (
  value: string | null
): { category: LibraryCategory; sources: LibrarySource[] | null } => {
  if (value === LEGACY_STEAM_LIBRARY_CATEGORY) {
    return { category: "pc", sources: ["steam"] };
  }

  return { category: isLibraryCategory(value) ? value : "all", sources: null };
};

export const readStoredLibraryFilters = (
  storage: Pick<Storage, "getItem" | "setItem">,
  categoryKey: string,
  sourcesKey: string
): { category: LibraryCategory; sources: LibrarySource[] } => {
  const { category, sources } = resolveStoredLibraryCategory(
    storage.getItem(categoryKey)
  );

  if (sources) {
    storage.setItem(categoryKey, category);
    storage.setItem(sourcesKey, JSON.stringify(sources));
    return { category, sources };
  }

  return {
    category,
    sources: parseStoredLibrarySources(storage.getItem(sourcesKey)),
  };
};

export const isSteamLibraryGame = (game: LibraryCategoryGame) =>
  game.hasActiveSteamImport === true;

export const isClassicsGame = (game: LibraryCategoryGame) =>
  game.shop === "launchbox";

export const getLibraryGameSource = (
  game: LibraryCategoryGame
): LibrarySource => (isSteamLibraryGame(game) ? "steam" : "hydra");

export const hasSteamLibraryGames = (games: LibraryCategoryGame[]) =>
  games.some(isSteamLibraryGame);

export const getLibraryFilterOptions = (games: LibraryFilterGame[]) => ({
  hasSteamGames: hasSteamLibraryGames(games),
  platforms: Array.from(
    new Set(
      games.flatMap((game) =>
        isClassicsGame(game) && game.platform ? [game.platform] : []
      )
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
});

export const shouldShowSteamLibraryBadge = (
  game: LibraryCategoryGame,
  hideSteamLibraryBadges = false
) => !hideSteamLibraryBadges && isSteamLibraryGame(game);

export const categoryShowsSources = (category: LibraryCategory) =>
  category === "all" || category === "pc";

export const categoryShowsPlatforms = (category: LibraryCategory) =>
  category === "all" || category === "classics";

export const filterLibraryGamesByCategory = <T extends LibraryCategoryGame>(
  games: T[],
  category: LibraryCategory
): T[] => {
  if (category === "pc") {
    return games.filter((game) => !isClassicsGame(game));
  }

  if (category === "classics") {
    return games.filter(isClassicsGame);
  }

  return games;
};

export const filterLibraryGames = <T extends LibraryFilterGame>(
  games: T[],
  { category, sources, platforms }: LibraryGameFilters
): T[] => {
  const categoryGames = filterLibraryGamesByCategory(games, category);
  const selectedSources = new Set(
    categoryShowsSources(category) ? sources : []
  );
  const selectedPlatforms = new Set(
    categoryShowsPlatforms(category) ? platforms : []
  );

  if (selectedSources.size === 0 && selectedPlatforms.size === 0) {
    return categoryGames;
  }

  return categoryGames.filter((game) => {
    if (isClassicsGame(game)) {
      return (
        selectedPlatforms.size === 0 ||
        Boolean(game.platform && selectedPlatforms.has(game.platform))
      );
    }

    return (
      selectedSources.size === 0 ||
      selectedSources.has(getLibraryGameSource(game))
    );
  });
};

export const getProfileLibraryFilter = (
  platform: LibraryCategory
): ProfileLibraryFilter => {
  if (platform === "classics") {
    return { shops: ["launchbox"] };
  }

  if (platform === "pc") {
    return { shops: ["steam"] };
  }

  return { shops: ["steam", "launchbox"] };
};

export const appendProfileLibraryFilterParams = (
  params: URLSearchParams,
  filter: ProfileLibraryFilter
) => {
  filter.shops.forEach((shop) => params.append("shop", shop));
};
