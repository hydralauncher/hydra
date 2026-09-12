import fs from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { Umu } from "@main/services";
import { updateGameInstallation } from "@main/services/game-installations";
import type { GameShop } from "@types";

const selectGameProtonPath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  protonPath: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  if (!protonPath) {
    await updateGameInstallation(game, {
      protonPath: null,
    });

    return;
  }

  const realProtonPath = await fs.promises.realpath(protonPath);

  if (!Umu.isValidProtonPath(realProtonPath)) {
    throw new Error("Invalid proton path");
  }

  await updateGameInstallation(game, {
    protonPath: realProtonPath,
  });
};

registerEvent("selectGameProtonPath", selectGameProtonPath);
