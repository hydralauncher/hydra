import path from "node:path";
import fs from "node:fs";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { logger } from "@main/services";
import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { downloadsSublevel, levelKeys } from "@main/level";

const deleteGameFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<void> => {
  const downloadKey = levelKeys.game(shop, objectId);

  const download = await downloadsSublevel.get(downloadKey);

  if (!download) return;

  if (download.folderName) {
    const folderPath = path.join(
      download.downloadPath ?? (await getDownloadsPath()),
      download.folderName
    );

    if (fs.existsSync(folderPath)) {
      await new Promise<void>((resolve, reject) => {
        fs.rm(
          folderPath,
          { recursive: true, force: true, maxRetries: 5, retryDelay: 200 },
          (error) => {
            if (error) {
              logger.error(error);
              reject();
            }

            resolve();
          }
        );
      });
    }
  }

  await downloadsSublevel.del(downloadKey);
};

registerEvent("deleteGameFolder", deleteGameFolder);
