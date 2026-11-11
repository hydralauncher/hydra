import { libraryWriteQueue } from "@main/services/library-sync/library-write-queue";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { HydraApi, logger } from "@main/services";
import {
  applyLibraryCollectionOrder,
  getLibraryCollectionOrderPositions,
} from "@shared";
import type { GameShop } from "@types";

type CollectionOrderGame = { shop: GameShop; objectId: string };

const ORDER_SAVE_TIMEOUT_MS = 30_000;

let pendingOrderSave: Promise<unknown> = Promise.resolve();

const saveCollectionGameOrder = async (
  collectionId: string,
  games: CollectionOrderGame[]
) => {
  await HydraApi.put(
    `/profile/games/collections/${encodeURIComponent(collectionId)}/order`,
    {
      games: games
        .filter((game) => game.shop !== "custom")
        .map(({ shop, objectId }) => ({ shop, objectId })),
    },
    { timeout: ORDER_SAVE_TIMEOUT_MS }
  );

  const positions = getLibraryCollectionOrderPositions(games);

  await libraryWriteQueue.run(async () => {
    const storedGames = await gamesSublevel.iterator().all();
    const updates = storedGames.flatMap(([key, game]) => {
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
  const save = pendingOrderSave.then(() =>
    saveCollectionGameOrder(collectionId, games)
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
