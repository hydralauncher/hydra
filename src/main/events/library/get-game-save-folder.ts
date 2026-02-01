import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi, logger } from "@main/services";
import path from "node:path";

const getGameSaveFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  try {
    const backupPreview = await Ludusavi.getBackupPreview(shop, objectId, null);

    if (!backupPreview) {
      return null;
    }

    const gameData = backupPreview.games[objectId];
    if (!gameData?.files) {
      return null;
    }

    const filePaths = Object.keys(gameData.files);
    if (filePaths.length === 0) {
      return null;
    }

    // Return the directory of the first save file found
    return path.dirname(filePaths[0]);
  } catch (error) {
    logger.error("[getGameSaveFolder] Error getting save folder:", error);
    return null;
  }
};

registerEvent("getGameSaveFolder", getGameSaveFolder);
