import { registerEvent } from "../register-event";
import { createGame } from "@main/services/library-sync";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import type { GameShop } from "@types";

const isGameNotFoundError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;

  const response = (error as { response?: { data?: { message?: unknown } } })
    .response;

  return response?.data?.message === "game/not-found";
};

const assignGameToCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  collectionId: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    throw new Error("game/not-found-local");
  }

  try {
    if (shop !== "custom") {
      const syncCollection = () =>
        HydraApi.put(`/profile/games/${shop}/${objectId}/collection`, {
          collectionId,
        });

      try {
        await syncCollection();
      } catch (error) {
        if (!isGameNotFoundError(error)) {
          throw error;
        }

        await createGame(game);
        await syncCollection();
      }
    }

    await gamesSublevel.put(gameKey, {
      ...game,
      collectionId,
    });
  } catch (error) {
    logger.error("Failed to assign game to collection", error);
    throw new Error(`Failed to assign game to collection: ${error}`);
  }
};

registerEvent("assignGameToCollection", assignGameToCollection);
