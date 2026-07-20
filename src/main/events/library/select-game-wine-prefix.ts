import { registerEvent } from "../register-event";
import fs from "node:fs";
import { levelKeys, gamesSublevel } from "@main/level";
import { Wine } from "@main/services";
import { runAutomaticCloudSaveSync } from "@main/services/cloud-save";
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
    const environmentChanged = Boolean(game.winePrefixPath);
    await gamesSublevel.put(gameKey, {
      ...game,
      winePrefixPath: null,
    });

    if (environmentChanged) {
      void runAutomaticCloudSaveSync(objectId, shop, "environment-changed");
    }

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

  if (game.winePrefixPath !== realWinePrefixPath) {
    void runAutomaticCloudSaveSync(objectId, shop, "environment-changed");
  }
};

registerEvent("selectGameWinePrefix", selectGameWinePrefix);
