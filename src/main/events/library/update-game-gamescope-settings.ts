import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const updatePromises: Record<string, Promise<void>> = {};

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

  const executeUpdate = async () => {
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    await gamesSublevel.put(gameKey, {
      ...game,
      ...settings,
    });
  };

  updatePromises[gameKey] = (updatePromises[gameKey] || Promise.resolve())
    .then(executeUpdate)
    .catch(() => {});

  await updatePromises[gameKey];
};

registerEvent("updateGameGamescopeSettings", updateGameGamescopeSettings);
