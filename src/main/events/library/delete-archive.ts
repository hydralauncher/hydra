import path from "node:path";
import fs from "node:fs";

import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const deleteArchive = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
) => {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info(`Deleted archive: ${filePath}`);
    }

    // Find the game that has this archive and clear installer size
    const normalizedPath = path.normalize(filePath);
    const downloads = await downloadsSublevel.values().all();

    for (const download of downloads) {
      if (!download.folderName) continue;

      const downloadPath = path.normalize(
        path.join(download.downloadPath, download.folderName)
      );

      if (downloadPath === normalizedPath) {
        const gameKey = levelKeys.game(download.shop, download.objectId);
        const game = await gamesSublevel.get(gameKey);

        if (game) {
          await gamesSublevel.put(gameKey, {
            ...game,
            installerSizeInBytes: null,
          });
        }
        break;
      }
    }

    return true;
  } catch (err) {
    logger.error(`Failed to delete archive: ${filePath}`, err);
    return false;
  }
};

registerEvent("deleteArchive", deleteArchive);
