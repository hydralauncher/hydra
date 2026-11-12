import {
  LibraryWriteQueue,
  libraryWriteQueue,
  markCollectionOrderChanged,
} from "@main/services/library-sync/library-write-queue";
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

const orderSaveQueue = new LibraryWriteQueue();

const getOrderKey = (game: CollectionOrderGame) =>
  `${game.shop}:${game.objectId}`;

const completeCollectionOrder = (
  collectionId: string,
  games: CollectionOrderGame[],
  storedGames: Game[]
): CollectionOrderGame[] => {
  if (games.length === 0) return games;

  const listedKeys = new Set(games.map(getOrderKey));
  const collectionGames = storedGames.filter(
    (game) =>
      !game.isDeleted && getLibraryCollectionIds(game).includes(collectionId)
  );
  const placedGames = collectionGames
    .flatMap((game) => {
      const position = game.collectionPositions?.[collectionId];
      return position === undefined ? [] : [{ game, position }];
    })
    .sort((a, b) => a.position - b.position)
    .map(({ game }) => game);
  const unplacedGames = collectionGames
    .filter(
      (game) =>
        game.collectionPositions?.[collectionId] === undefined &&
        !listedKeys.has(getOrderKey(game))
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  const completed = games.map(({ shop, objectId }) => ({ shop, objectId }));
  placedGames.forEach((game, index) => {
    if (listedKeys.has(getOrderKey(game))) return;

    const previousKey = index > 0 ? getOrderKey(placedGames[index - 1]) : null;
    const insertAt = previousKey
      ? completed.findIndex((listed) => getOrderKey(listed) === previousKey) + 1
      : 0;
    completed.splice(insertAt, 0, { shop: game.shop, objectId: game.objectId });
  });

  return [
    ...completed,
    ...unplacedGames.map(({ shop, objectId }) => ({ shop, objectId })),
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
    if (authContext && !HydraApi.isAuthContextCurrent(authContext)) return;

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
    markCollectionOrderChanged(collectionId);
  });
};

const setCollectionGameOrder = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: string,
  games: CollectionOrderGame[]
) => {
  const authContext = HydraApi.getAuthContext();

  try {
    await orderSaveQueue.run(() =>
      saveCollectionGameOrder(collectionId, games, authContext)
    );
  } catch (error) {
    logger.error("Failed to set collection game order", error);
    throw new Error(`Failed to set collection game order: ${error}`);
  }
};

registerEvent("setCollectionGameOrder", setCollectionGameOrder);
