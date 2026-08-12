import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const updateGameGamescopeSettings = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  settings: {
    gamescopeResolution?: string | null;
    gamescopeOutputResolution?: string | null;
    gamescopeUpscaler?: string | null;
    gamescopeFramerateLimit?: number | null;
  }
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    ...settings,
  });
};

registerEvent("updateGameGamescopeSettings", updateGameGamescopeSettings);
