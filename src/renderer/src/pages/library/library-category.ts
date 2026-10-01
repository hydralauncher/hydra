import type { CatalogueStoreScope } from "@shared";

export type LibraryCategory = "all" | "pc" | "steam_library" | "classics";

export interface LibraryCategoryGame {
  shop: string;
  hasActiveSteamImport?: boolean;
}

export interface ProfileLibraryFilter {
  shops: string[];
  steamLibrary: boolean;
}

export const isSteamLibraryGame = (game: LibraryCategoryGame) =>
  game.hasActiveSteamImport === true;

export const shouldShowSteamLibraryBadge = (
  game: LibraryCategoryGame,
  hideSteamLibraryBadges = false
) => !hideSteamLibraryBadges && isSteamLibraryGame(game);

export const shouldShowProfileSteamLibraryBadge = (
  game: LibraryCategoryGame,
  isOwnProfile: boolean,
  hideSteamLibraryBadges = false
) => isOwnProfile && shouldShowSteamLibraryBadge(game, hideSteamLibraryBadges);

export const filterLibraryGamesByCategory = <T extends LibraryCategoryGame>(
  games: T[],
  category: LibraryCategory
): T[] => {
  if (category === "pc") {
    return games.filter((game) => game.shop !== "launchbox");
  }

  if (category === "steam_library") {
    return games.filter(isSteamLibraryGame);
  }

  if (category === "classics") {
    return games.filter((game) => game.shop === "launchbox");
  }

  return games;
};

export const filterLibraryGamesByShop = <T extends LibraryCategoryGame>(
  games: T[],
  shop: CatalogueStoreScope
): T[] => (shop === "all" ? games : games.filter((game) => game.shop === shop));

export const getProfileLibraryFilter = (
  platform: LibraryCategory
): ProfileLibraryFilter => {
  if (platform === "classics") {
    return { shops: ["launchbox"], steamLibrary: false };
  }

  if (platform === "steam_library") {
    return { shops: ["steam"], steamLibrary: true };
  }

  if (platform === "pc") {
    return { shops: ["steam"], steamLibrary: false };
  }

  return { shops: ["steam", "launchbox"], steamLibrary: false };
};

export const appendProfileLibraryFilterParams = (
  params: URLSearchParams,
  filter: ProfileLibraryFilter
) => {
  filter.shops.forEach((shop) => params.append("shop", shop));
  if (filter.steamLibrary) params.set("steamLibrary", "true");
};
