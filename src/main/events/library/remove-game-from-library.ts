import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { levelKeys } from "@main/level";
import { gamesSublevel } from "@main/level";
import type { GameShop } from "@types";

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      isDeleted: true,
      executablePath: null,
    });

    if (game?.remoteId) {
      HydraApi.delete(`/profile/games/${game.remoteId}`).catch(() => {});
    }
  }
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
