import path from "node:path";
import type { GameShop, UserPreferences } from "@types";
import { getNotProtonToolName, Umu } from "@main/services";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";

const getGameLaunchProtonVersion = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return null;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const formatName = (protonPath: string) =>
    process.platform === "darwin"
      ? getNotProtonToolName(protonPath)
      : path.basename(protonPath);

  const gameProtonPath = game?.protonPath;
  if (gameProtonPath && Umu.isValidProtonPath(gameProtonPath)) {
    return formatName(gameProtonPath);
  }

  const defaultProtonPath = userPreferences?.defaultProtonPath;
  if (defaultProtonPath && Umu.isValidProtonPath(defaultProtonPath)) {
    return formatName(defaultProtonPath);
  }

  return null;
};

registerEvent("getGameLaunchProtonVersion", getGameLaunchProtonVersion);
