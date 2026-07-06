import { shell } from "electron";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";

const openSteamGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  if (shop !== "steam" || !/^\d+$/.test(objectId)) {
    throw new Error("Game cannot be launched through Steam");
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game?.launchThroughSteam) {
    throw new Error("Game cannot be launched through Steam");
  }

  logger.info(`[SteamLibrary] Launching ${objectId} through Steam`);

  await shell.openExternal(`steam://rungameid/${objectId}`);

  await gamesSublevel.put(gameKey, {
    ...game,
    lastTimePlayed: new Date(),
  });
};

registerEvent("openSteamGame", openSteamGame);
