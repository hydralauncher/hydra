import { gameRepository } from "@main/repository";
import { chunk } from "lodash-es";
import { IsNull } from "typeorm";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { AxiosError } from "axios";

import { mergeWithRemoteGames } from "./merge-with-remote-games";
import { WindowManager } from "../window-manager";

export const uploadGamesBatch = async () => {
  try {
    const games = await gameRepository.find({
      where: { remoteId: IsNull(), isDeleted: false },
    });

    const gamesChunks = chunk(games, 200);

    for (const chunk of gamesChunks) {
      await HydraApi.post(
        "/games/batch",
        chunk.map((game) => {
          return {
            objectId: game.objectID,
            playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
            shop: game.shop,
            lastTimePlayed: game.lastTimePlayed,
          };
        })
      );
    }

    await mergeWithRemoteGames();

    if (WindowManager.mainWindow)
      WindowManager.mainWindow.webContents.send("on-library-batch-complete");
  } catch (err) {
    if (err instanceof AxiosError) {
      logger.error("uploadGamesBatch", err.response, err.message);
    } else {
      logger.error("uploadGamesBatch", err);
    }
  }
};
