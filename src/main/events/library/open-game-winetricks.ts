import { spawn } from "node:child_process";
import path from "node:path";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger, SystemPath } from "@main/services";
import type { GameShop } from "@types";

const openGameWinetricks = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  if (process.platform !== "linux") {
    return false;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return false;

  const defaultPrefixPath = path.join(
    SystemPath.getPath("home"),
    "Games",
    "umu",
    "umu-default"
  );

  const winePrefixPath = game.winePrefixPath || defaultPrefixPath;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("winetricks", {
        detached: true,
        stdio: "ignore",
        shell: false,
        env: {
          ...process.env,
          WINEPREFIX: winePrefixPath,
        },
      });

      child.once("spawn", () => {
        child.unref();
        resolve();
      });

      child.once("error", reject);
    });

    return true;
  } catch (error) {
    logger.error("Failed to launch winetricks", error);
    return false;
  }
};

registerEvent("openGameWinetricks", openGameWinetricks);
