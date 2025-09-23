import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const removeGameFromPinned = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  HydraApi.put(`/profile/games/${shop}/${objectId}/unpin`).catch(() => {});

  try {
    await gamesSublevel.put(gameKey, {
      ...game,
      pinned: false,
    });
  } catch (error) {
    throw new Error(`Failed to update game pinned status: ${error}`);
  }
};

registerEvent("removeGameFromPinned", removeGameFromPinned);