import type { LibraryGame } from "@types";
import { getLibraryCollectionIds } from "@shared";
import {
  getLibraryGameOrderKey,
  type OrderableLibraryGame,
} from "./library-custom-order";

type GameIdentity = Pick<LibraryGame, "shop" | "objectId">;

type CollectionGame = GameIdentity &
  Pick<LibraryGame, "collectionIds" | "collectionPositions">;

export const getLibraryCollectionGames = <T extends CollectionGame>(
  games: readonly T[],
  collectionId: string
): T[] => {
  const seen = new Set<string>();

  return games.filter((game) => {
    const key = getLibraryGameOrderKey(game);
    if (seen.has(key) || !getLibraryCollectionIds(game).includes(collectionId))
      return false;

    seen.add(key);
    return true;
  });
};

export const buildLibraryCollectionOrder = <T extends CollectionGame>(
  collectionGames: readonly T[],
  collectionId: string,
  sortUnplaced: (games: T[]) => T[]
): string[] => {
  const placed: { game: T; position: number }[] = [];
  const unplaced: T[] = [];

  for (const game of collectionGames) {
    const position = game.collectionPositions?.[collectionId];
    if (typeof position === "number") {
      placed.push({ game, position });
    } else {
      unplaced.push(game);
    }
  }

  placed.sort((a, b) => a.position - b.position);

  return [...placed.map(({ game }) => game), ...sortUnplaced(unplaced)].map(
    getLibraryGameOrderKey
  );
};

export const hasLibraryCollectionOrder = (
  collectionGames: readonly CollectionGame[],
  collectionId: string
) =>
  collectionGames.some(
    (game) => typeof game.collectionPositions?.[collectionId] === "number"
  );

export const expandLibraryCollectionOrder = (
  order: readonly string[],
  collectionGames: readonly GameIdentity[],
  groups: readonly OrderableLibraryGame[]
): GameIdentity[] => {
  const gamesByKey = new Map(
    collectionGames.map((game) => [getLibraryGameOrderKey(game), game])
  );
  const groupKeys = new Map<string, string[]>();
  for (const group of groups) {
    const keys = [group, ...(group.members ?? [])].map(getLibraryGameOrderKey);
    for (const key of keys) groupKeys.set(key, keys);
  }

  const expanded: GameIdentity[] = [];
  const emitted = new Set<string>();
  const emit = (key: string) => {
    const game = gamesByKey.get(key);
    if (!game || emitted.has(key)) return;

    emitted.add(key);
    expanded.push({ shop: game.shop, objectId: game.objectId });
  };

  for (const key of [...order, ...gamesByKey.keys()]) {
    emit(key);
    for (const memberKey of groupKeys.get(key) ?? []) emit(memberKey);
  }

  return expanded;
};

export const isSameLibraryOrder = (
  a: readonly string[],
  b: readonly string[]
) => a.length === b.length && a.every((key, index) => key === b[index]);
