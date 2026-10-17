import { updateGameRecord } from "@main/services/game-record-updater";
import fs from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { Umu } from "@main/services";
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
    await updateGameRecord(gameKey, {
      protonPath: null,
    });

    return;
  }

  const realProtonPath = await fs.promises.realpath(protonPath);

  if (!Umu.isValidProtonPath(realProtonPath)) {
    throw new Error("Invalid proton path");
  }

  await updateGameRecord(gameKey, {
    protonPath: realProtonPath,
  });
};

registerEvent("selectGameProtonPath", selectGameProtonPath);
