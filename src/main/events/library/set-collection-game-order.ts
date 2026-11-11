import { libraryWriteQueue } from "@main/services/library-sync/library-write-queue";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { HydraApi, logger } from "@main/services";
import {
  applyLibraryCollectionOrder,
  getLibraryCollectionIds,
  getLibraryCollectionOrderPositions,
} from "@shared";
import type { Game, GameShop } from "@types";

type CollectionOrderGame = { shop: GameShop; objectId: string };
type AuthContext = ReturnType<typeof HydraApi.getAuthContext>;

const ORDER_SAVE_TIMEOUT_MS = 30_000;

let pendingOrderSave: Promise<unknown> = Promise.resolve();

const getOrderKey = (game: CollectionOrderGame) =>
  `${game.shop}:${game.objectId}`;

const completeCollectionOrder = (
  collectionId: string,
  games: CollectionOrderGame[],
  storedGames: Game[]
): CollectionOrderGame[] => {
  if (games.length === 0) return games;

  const listedKeys = new Set(games.map(getOrderKey));
  const getPosition = (game: Game) =>
    game.collectionPositions?.[collectionId] ?? Number.MAX_SAFE_INTEGER;
  const omittedGames = storedGames
    .filter(
      (game) =>
        !game.isDeleted &&
        getLibraryCollectionIds(game).includes(collectionId) &&
        !listedKeys.has(getOrderKey(game))
    )
    .sort((a, b) => getPosition(a) - getPosition(b));

  return [
    ...games,
    ...omittedGames.map(({ shop, objectId }) => ({ shop, objectId })),
  ];
};

const saveCollectionGameOrder = async (
  collectionId: string,
  requestedGames: CollectionOrderGame[],
  authContext: AuthContext
) => {
  const storedGames = await gamesSublevel.values().all();
  const games = completeCollectionOrder(
    collectionId,
    requestedGames,
    storedGames
  );

  await HydraApi.put(
    `/profile/games/collections/${encodeURIComponent(collectionId)}/order`,
    {
      games: games
        .filter((game) => game.shop !== "custom")
        .map(({ shop, objectId }) => ({ shop, objectId })),
    },
    { timeout: ORDER_SAVE_TIMEOUT_MS, authContext: authContext ?? undefined }
  );

  const positions = getLibraryCollectionOrderPositions(games);

  await libraryWriteQueue.run(async () => {
    const currentGames = await gamesSublevel.iterator().all();
    const updates = currentGames.flatMap(([key, game]) => {
      const collectionPositions = applyLibraryCollectionOrder(
        game,
        collectionId,
        positions
      );
      const hasChanged =
        !game.isDeleted &&
        collectionPositions &&
        collectionPositions[collectionId] !==
          game.collectionPositions?.[collectionId];
      return hasChanged
        ? [
            {
              type: "put" as const,
              key,
              value: { ...game, collectionPositions },
            },
          ]
        : [];
    });

    if (updates.length) await gamesSublevel.batch(updates);
  });
};

const setCollectionGameOrder = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: string,
  games: CollectionOrderGame[]
) => {
  const authContext = HydraApi.getAuthContext();
  const save = pendingOrderSave.then(() =>
    saveCollectionGameOrder(collectionId, games, authContext)
  );
  pendingOrderSave = save.catch(() => undefined);

  try {
    await save;
  } catch (error) {
    logger.error("Failed to set collection game order", error);
    throw new Error(`Failed to set collection game order: ${error}`);
  }
};

registerEvent("setCollectionGameOrder", setCollectionGameOrder);
