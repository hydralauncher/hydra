import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

const setGameHydraPlaytimeDisabled = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  disabled: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    disableHydraPlaytimeTracking: disabled,
  });
};

registerEvent("setGameHydraPlaytimeDisabled", setGameHydraPlaytimeDisabled);
