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
    where: [
      {
        id: gameId,
        isDeleted: false,
        status: "removed",
      },
      {
        id: gameId,
        progress: 1,
        isDeleted: false,
      },
    ],
  });

  if (!game) return;

  if (game.folderName) {
    const folderPath = path.join(
      game.downloadPath ?? (await getDownloadsPath()),
      game.folderName
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

            const aria2ControlFilePath = `${folderPath}.aria2`;
            if (fs.existsSync(aria2ControlFilePath))
              fs.rmSync(aria2ControlFilePath);

            resolve();
          }
        );
      });
    }
  }

  await gameRepository.update(
    { id: gameId },
    { downloadPath: null, folderName: null, status: null, progress: 0 }
  );
};

registerEvent("deleteGameFolder", deleteGameFolder);
