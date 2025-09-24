import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const addGameToPinned = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  HydraApi.put(`/profile/games/${shop}/${objectId}/pin`).catch(() => {});

  try {
    await gamesSublevel.put(gameKey, {
      ...game,
      pinned: true,
      pinnedDate: new Date(),
    });
  } catch (error) {
    throw new Error(`Failed to update game pinned status: ${error}`);
  }
};

registerEvent("addGameToPinned", addGameToPinned);
