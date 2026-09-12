import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";
import { updateGameInstallation } from "@main/services/game-installations";

const toggleGameGamemode = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  autoRunGamemode: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await updateGameInstallation(game, {
    autoRunGamemode,
  });
};

registerEvent("toggleGameGamemode", toggleGameGamemode);
