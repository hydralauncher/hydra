import { ipcMain } from "electron";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

ipcMain.handle(
  "updateGameRunner",
  async (_, shop: GameShop, objectId: string, runnerPath: string) => {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);

    if (game) {
      await gamesSublevel.put(gameKey, {
        ...game,
        linux: {
          ...game.linux,
          runnerPath,
        },
      });
    }
  }
);
