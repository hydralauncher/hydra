import type { GameShop, LibraryGame } from "@types";

export type LibraryGameState = {
  libraryGame: LibraryGame | null;
  isInLibrary: boolean;
  hasExecutable: boolean;
};

export function getLibraryGameState(
  library: LibraryGame[],
  shop: GameShop,
  objectId: string
): LibraryGameState {
  const libraryGame =
    library.find((g) => g.shop === shop && g.objectId === objectId) ?? null;

  return {
    libraryGame,
    isInLibrary: libraryGame !== null,
    hasExecutable: Boolean(libraryGame?.executablePath),
  };
}
