import fs from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger, RedistManager, WindowManager, Wine } from "@main/services";
import type { GameShop } from "@types";

const installGameRedist = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  packageName: string,
  silentArgs: string[],
  localPath?: string | null
): Promise<boolean> => {
  if (process.platform !== "linux") {
    return false;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    logger.warn("installGameRedist: Game not found", { shop, objectId });
    return false;
  }

  const winePrefixPath = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    objectId
  );

  if (!winePrefixPath) {
    logger.warn("installGameRedist: No Wine prefix path", { shop, objectId });
    return false;
  }

  try {
    let installerPath = localPath ?? null;

    if (!installerPath || !fs.existsSync(installerPath)) {
      installerPath = await RedistManager.downloadRedist(
        packageName,
        (progress) => {
          WindowManager.sendToAppWindows(
            "on-redist-download-progress",
            progress
          );
        }
      );
    }

    const success = await RedistManager.installRedist(
      installerPath,
      silentArgs,
      winePrefixPath
    );

    return success;
  } catch (error) {
    logger.error("installGameRedist failed", {
      shop,
      objectId,
      packageName,
      error,
    });
    return false;
  }
};

registerEvent("installGameRedist", installGameRedist);
