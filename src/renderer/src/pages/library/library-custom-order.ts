import type { LibraryGame } from "@types";

export const LIBRARY_CUSTOM_ORDER_STORAGE_KEY = "library-custom-order";

export type LibraryDropEdge = "before" | "after";

type GameIdentity = Pick<LibraryGame, "shop" | "objectId">;

export type OrderableLibraryGame = GameIdentity & {
  members?: readonly GameIdentity[];
};

export const getLibraryGameOrderKey = (game: GameIdentity): string =>
  `${game.shop}:${game.objectId}`;

const getGameOrderKeys = (game: OrderableLibraryGame): string[] => [
  getLibraryGameOrderKey(game),
  ...(game.members ?? []).map(getLibraryGameOrderKey),
];

const getLibraryCustomOrderStorageKey = (accountId: string | null) =>
  accountId
    ? `${LIBRARY_CUSTOM_ORDER_STORAGE_KEY}:${accountId}`
    : LIBRARY_CUSTOM_ORDER_STORAGE_KEY;

export const readLibraryCustomOrder = (
  storage: Pick<Storage, "getItem">,
  accountId: string | null
): string[] => {
  try {
    const saved = storage.getItem(getLibraryCustomOrderStorageKey(accountId));
    if (!saved) return [];

    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

export const writeLibraryCustomOrder = (
  storage: Pick<Storage, "setItem">,
  accountId: string | null,
  order: readonly string[]
) => {
  storage.setItem(
    getLibraryCustomOrderStorageKey(accountId),
    JSON.stringify(order)
  );
};

const indexOrder = (order: readonly string[]) => {
  const positions = new Map<string, number>();
  order.forEach((key, index) => {
    if (!positions.has(key)) positions.set(key, index);
  });
  return positions;
};

const findGamePosition = (
  game: OrderableLibraryGame,
  positions: ReadonlyMap<string, number>
): number | undefined => {
  let earliest: number | undefined;
  for (const key of getGameOrderKeys(game)) {
    const position = positions.get(key);
    if (
      position !== undefined &&
      (earliest === undefined || position < earliest)
    ) {
      earliest = position;
    }
  }
  return earliest;
};

export const sortLibraryGamesByCustomOrder = <T extends OrderableLibraryGame>(
  games: readonly T[],
  order: readonly string[],
  sortUnplaced: (games: T[]) => T[]
): T[] => {
  const positions = indexOrder(order);
  const placed: { game: T; position: number }[] = [];
  const unplaced: T[] = [];

  for (const game of games) {
    const position = findGamePosition(game, positions);
    if (position === undefined) {
      unplaced.push(game);
    } else {
      placed.push({ game, position });
    }
  }

  placed.sort((a, b) => a.position - b.position);

  return [...placed.map(({ game }) => game), ...sortUnplaced(unplaced)];
};

export const moveLibraryGameInCustomOrder = (
  order: readonly string[],
  displayedGames: readonly OrderableLibraryGame[],
  sourceKey: string,
  targetKey: string,
  edge: LibraryDropEdge
): string[] => {
  if (sourceKey === targetKey) return [...order];

  const sourceGame = displayedGames.find(
    (game) => getLibraryGameOrderKey(game) === sourceKey
  );
  const targetGame = displayedGames.find(
    (game) => getLibraryGameOrderKey(game) === targetKey
  );
  if (!sourceGame || !targetGame) return [...order];

  const next = [...indexOrder(order).keys()];
  const known = new Set(next);

  for (const game of displayedGames) {
    const keys = getGameOrderKeys(game);
    if (keys.some((key) => known.has(key))) continue;

    const key = getLibraryGameOrderKey(game);
    next.push(key);
    known.add(key);
  }

  const sourceKeys = [...new Set(getGameOrderKeys(sourceGame))];
  const withoutSource = next.filter((key) => !sourceKeys.includes(key));

  const targetPosition = findGamePosition(
    targetGame,
    indexOrder(withoutSource)
  );
  if (targetPosition === undefined) return [...order];

  withoutSource.splice(
    edge === "before" ? targetPosition : targetPosition + 1,
    0,
    ...sourceKeys
  );

  return withoutSource;
};
