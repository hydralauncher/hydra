import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const toggleGameGamescope = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  autoRunGamescope: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    autoRunGamescope,
  });
};

registerEvent("toggleGameGamescope", toggleGameGamescope);
