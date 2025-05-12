import { registerEvent } from "../register-event";
import fs from "node:fs";
import { levelKeys, gamesSublevel } from "@main/level";
import { Wine } from "@main/services";
import type { GameShop } from "@types";

const selectGameWinePrefix = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  winePrefixPath: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  if (!winePrefixPath) {
    await gamesSublevel.put(gameKey, {
      ...game,
      winePrefixPath: null,
    });

    return;
  }

  const realWinePrefixPath = await fs.promises.realpath(winePrefixPath);

  if (!Wine.validatePrefix(realWinePrefixPath)) {
    throw new Error("Invalid wine prefix path");
  }

  await gamesSublevel.put(gameKey, {
    ...game,
    winePrefixPath: realWinePrefixPath,
  });
};

registerEvent("selectGameWinePrefix", selectGameWinePrefix);
