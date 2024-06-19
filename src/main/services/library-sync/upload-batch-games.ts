import { gameRepository } from "@main/repository";
import { chunk } from "lodash-es";
import { IsNull } from "typeorm";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { AxiosError } from "axios";

export const uploadBatchGames = async () => {
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
  } catch (err) {
    if (err instanceof AxiosError) {
      logger.error("uploadBatchGames", err.response, err.message);
    } else {
      logger.error("uploadBatchGames", err);
    }
  }
};
