import { gameRepository } from "@main/repository";
import { chunk } from "lodash-es";
import { IsNull } from "typeorm";
import { HydraApi } from "../hydra-api";
import { mergeWithRemoteGames } from "./merge-with-remote-games";
import { WindowManager } from "../window-manager";

export const uploadGamesBatch = async () => {
  const games = await gameRepository.find({
    where: { remoteId: IsNull(), isDeleted: false },
  });

  const gamesChunks = chunk(games, 200);

  for (const chunk of gamesChunks) {
    await HydraApi.post(
      "/profile/games/batch",
      chunk.map((game) => {
        return {
          objectId: game.objectID,
          playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
          shop: game.shop,
          lastTimePlayed: game.lastTimePlayed,
        };
      })
    ).catch(() => {});
  }

  await mergeWithRemoteGames();

  if (WindowManager.mainWindow)
    WindowManager.mainWindow.webContents.send("on-library-batch-complete");
};
