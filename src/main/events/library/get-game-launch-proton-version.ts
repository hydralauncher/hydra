import path from "node:path";
import type { GameShop, UserPreferences } from "@types";
import { Umu } from "@main/services";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";

const getGameLaunchProtonVersion = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  if (process.platform !== "linux") {
    return null;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const gameProtonPath = game?.protonPath;
  if (gameProtonPath && Umu.isValidProtonPath(gameProtonPath)) {
    return path.basename(gameProtonPath);
  }

  const defaultProtonPath = userPreferences?.defaultProtonPath;
  if (defaultProtonPath && Umu.isValidProtonPath(defaultProtonPath)) {
    return path.basename(defaultProtonPath);
  }

  return null;
};

registerEvent("getGameLaunchProtonVersion", getGameLaunchProtonVersion);
