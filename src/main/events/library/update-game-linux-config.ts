import { ipcMain } from "electron";
import { gamesSublevel, levelKeys } from "@main/level";
import type { Game, GameShop } from "@types";

ipcMain.handle(
  "updateGameLinuxConfig",
  async (_, shop: GameShop, objectId: string, linuxConfig: Game["linux"]) => {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);

    if (game) {
      await gamesSublevel.put(gameKey, {
        ...game,
        linux: {
          ...game.linux,
          ...linuxConfig,
        },
      });
    }
  }
);
