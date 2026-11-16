import path from "node:path";
import type { GameShop } from "@types";
import { resolveProtonPath } from "@main/helpers/resolve-proton-path";
import { getNotProtonToolName } from "@main/services";
import { gamesSublevel, levelKeys } from "@main/level";
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
  const protonPath = await resolveProtonPath(game?.protonPath);

  if (!protonPath) return null;

  return process.platform === "darwin"
    ? getNotProtonToolName(protonPath)
    : path.basename(protonPath);
};

registerEvent("getGameLaunchProtonVersion", getGameLaunchProtonVersion);
