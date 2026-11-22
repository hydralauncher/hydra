import type {
  Game,
  PlayLaterEntry,
  PlayLaterSort,
  PlayLaterViewMode,
  ShopAssets,
} from "@types";
import { getGameCatalogueIdentity } from "./library-catalogue.js";

type GameIdentity = Pick<ShopAssets, "shop" | "objectId">;

const keyOf = ({ shop, objectId }: GameIdentity) => `${shop}:${objectId}`;

type LibraryIdentity = Pick<
  Game,
  "shop" | "objectId" | "isDeleted" | "catalogueGame"
>;

// Deleted games don't count, and a library game also covers the catalogue game
// it is linked to (e.g. an Epic import of a Steam game).
const libraryKeysOf = (library: LibraryIdentity[]) =>
  new Set(
    library
      .filter((game) => !game.isDeleted)
      .flatMap((game) => [keyOf(game), keyOf(getGameCatalogueIdentity(game))])
  );

export const isInLibrary = (
  game: GameIdentity,
  library: LibraryIdentity[]
): boolean => libraryKeysOf(library).has(keyOf(game));

/** Drops the entries whose game is in the library. */
export const withoutLibraryGames = <T extends GameIdentity>(
  entries: T[],
  library: LibraryIdentity[]
): T[] => {
  const libraryKeys = libraryKeysOf(library);
  return entries.filter((entry) => !libraryKeys.has(keyOf(entry)));
};

export const sortPlayLater = (
  entries: PlayLaterEntry[],
  sort: PlayLaterSort
): PlayLaterEntry[] =>
  [...entries].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      : b.addedAt - a.addedAt
  );

const VIEW_MODES: PlayLaterViewMode[] = ["compact", "grid", "large"];

/** Reads a saved view mode; anything unknown falls back to compact, like the library. */
export const parsePlayLaterViewMode = (
  value: string | null
): PlayLaterViewMode => VIEW_MODES.find((mode) => mode === value) ?? "compact";

export const parsePlayLaterSort = (value: string | null): PlayLaterSort =>
  value === "title" ? "title" : "addedAt";
