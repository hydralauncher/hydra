import type { LibraryGame } from "@types";

const isSameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;

  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => isSameValue(item, b[index]));
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;

  return aKeys.every(
    (key) =>
      Object.hasOwn(bRecord, key) && isSameValue(aRecord[key], bRecord[key])
  );
};

const getLibraryGameKey = (game: LibraryGame) =>
  `${game.shop}:${game.objectId}`;

export const reconcileLibraryGames = (
  previous: readonly LibraryGame[],
  next: readonly LibraryGame[]
): readonly LibraryGame[] => {
  const previousByKey = new Map(
    previous.map((game) => [getLibraryGameKey(game), game])
  );
  let hasChanged = previous.length !== next.length;

  const reconciled = next.map((game, index) => {
    const previousGame = previousByKey.get(getLibraryGameKey(game));
    const result =
      previousGame && isSameValue(previousGame, game) ? previousGame : game;
    if (result !== previous[index]) hasChanged = true;
    return result;
  });

  return hasChanged ? reconciled : previous;
};

export const isSameLibraryList = (
  a: readonly LibraryGame[],
  b: readonly LibraryGame[]
) => a.length === b.length && a.every((game, index) => game === b[index]);
