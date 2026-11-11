import type { GameShop } from "../types/game.types";

export function getLibraryCollectionIds(
  game:
    | { collectionIds?: string[] | null; collectionId?: string | null }
    | null
    | undefined
): string[] {
  if (Array.isArray(game?.collectionIds)) return game.collectionIds;
  return game?.collectionId ? [game.collectionId] : [];
}

export type LibraryCollectionPositions = Record<string, number>;

interface CollectionOrderGame {
  shop: GameShop;
  objectId: string;
}

const getCollectionOrderKey = (game: CollectionOrderGame) =>
  `${game.shop}:${game.objectId}`;

export function pickLibraryCollectionPositions(
  positions: unknown,
  collectionIds: readonly string[]
): LibraryCollectionPositions {
  if (
    typeof positions !== "object" ||
    positions === null ||
    Array.isArray(positions)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(positions).filter(
      ([collectionId, position]) =>
        collectionIds.includes(collectionId) &&
        typeof position === "number" &&
        Number.isFinite(position)
    )
  );
}

export function getLibraryCollectionOrderPositions(
  games: readonly CollectionOrderGame[]
): Map<string, number> {
  const positions = new Map<string, number>();
  const localOnlyKeys: string[] = [];
  let syncedIndex = -1;

  const placeLocalOnlyGames = () => {
    localOnlyKeys.forEach((key, index) =>
      positions.set(key, syncedIndex + (index + 1) / (localOnlyKeys.length + 1))
    );
    localOnlyKeys.length = 0;
  };

  for (const game of games) {
    const key = getCollectionOrderKey(game);
    if (positions.has(key) || localOnlyKeys.includes(key)) continue;

    if (game.shop === "custom") {
      localOnlyKeys.push(key);
      continue;
    }

    placeLocalOnlyGames();
    syncedIndex += 1;
    positions.set(key, syncedIndex);
  }
  placeLocalOnlyGames();

  return positions;
}

export function applyLibraryCollectionOrder(
  game: CollectionOrderGame & {
    collectionIds?: string[] | null;
    collectionId?: string | null;
    collectionPositions?: LibraryCollectionPositions;
  },
  collectionId: string,
  positions: ReadonlyMap<string, number>
): LibraryCollectionPositions | null {
  if (!getLibraryCollectionIds(game).includes(collectionId)) return null;

  const next = { ...game.collectionPositions };
  delete next[collectionId];
  const position = positions.get(getCollectionOrderKey(game));
  if (position !== undefined) next[collectionId] = position;
  return next;
}

export function getLibraryGroupCollectionAssignments<
  T extends {
    shop: GameShop;
    objectId: string;
    collectionIds?: string[];
    collectionId?: string | null;
  },
>(members: readonly T[], collectionIds: readonly string[]) {
  const previous = new Set(members.flatMap(getLibraryCollectionIds));
  const added = collectionIds.filter((id) => !previous.has(id));
  const removed = new Set(
    [...previous].filter((id) => !collectionIds.includes(id))
  );
  return members.map((game) => ({
    game,
    collectionIds: [
      ...new Set([...getLibraryCollectionIds(game), ...added]),
    ].filter((id) => !removed.has(id)),
  }));
}

export async function applyLibraryGroupAction<
  T extends { shop: GameShop; objectId: string },
>(members: readonly T[], action: (game: T) => Promise<unknown>): Promise<void> {
  const unique = new Map(
    members.map((game) => [`${game.shop}:${game.objectId}`, game])
  );
  const results = await Promise.allSettled(
    [...unique.values()].map((game) =>
      Promise.resolve().then(() => action(game))
    )
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (errors.length) {
    throw new AggregateError(errors, "Library group update partially failed");
  }
}
