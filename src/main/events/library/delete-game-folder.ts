import fs from "node:fs";
import path from "node:path";

import { gameRepository } from "@main/repository";

import { logger } from "@main/services";
import { getDownloadsPath } from "../helpers/get-downloads-path";
import { registerEvent } from "../register-event";

const deleteGameFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
    },
  });

  if (!game) return;

  if (game.folderName) {
    const folderPath = path.join(await getDownloadsPath(), game.folderName);

    if (fs.existsSync(folderPath)) {
      return new Promise((resolve, reject) => {
        fs.rm(
          folderPath,
          { recursive: true, force: true, maxRetries: 5, retryDelay: 200 },
          (error) => {
            if (error) {
              logger.error(error);
              reject();
            }
            resolve(null);
          }
        );
      });
    }
  }
};

registerEvent(deleteGameFolder, {
  name: "deleteGameFolder",
});
