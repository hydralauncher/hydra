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
