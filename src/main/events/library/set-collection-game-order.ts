import { updateGameRecord } from "@main/services/game-record-updater";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { HydraApi, logger } from "@main/services";
import {
  applyLibraryCollectionOrder,
  getLibraryCollectionOrderPositions,
} from "@shared";
import type { GameShop } from "@types";

type CollectionOrderGame = { shop: GameShop; objectId: string };

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
    }
  );

  const positions = getLibraryCollectionOrderPositions(games);
  const storedGames = await gamesSublevel.iterator().all();

  for (const [key, game] of storedGames) {
    const collectionPositions = applyLibraryCollectionOrder(
      game,
      collectionId,
      positions
    );
    if (
      collectionPositions &&
      collectionPositions[collectionId] !==
        game.collectionPositions?.[collectionId]
    ) {
      await updateGameRecord(key, { collectionPositions });
    }
  }
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
