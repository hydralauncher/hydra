import path from "node:path";
import fs from "node:fs";

import { gameRepository } from "@main/repository";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { logger } from "@main/services";
import { registerEvent } from "../register-event";

const deleteGameFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
): Promise<void> => {
  const game = await gameRepository.findOne({
    where: {
      id: gameId,
      status: "removed",
      isDeleted: false,
    },
  });

  if (!game) return;

  if (game.folderName) {
    const folderPath = path.join(
      game.downloadPath ?? (await getDownloadsPath()),
      game.folderName
    );

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

            resolve();
          }
        );
      });
    }
  }
};

registerEvent("deleteGameFolder", deleteGameFolder);
