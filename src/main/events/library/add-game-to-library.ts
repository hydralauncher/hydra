import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

import type { Game, GameShop } from "@types";

import { steamGamesWorker } from "@main/workers";
import { createGame } from "@main/services/library-sync";
import { steamUrlBuilder } from "@shared";
import { updateLocalUnlockedAchivements } from "@main/services/achievements/update-local-unlocked-achivements";
import { gamesSublevel, levelKeys } from "@main/level";

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string
) => {
  return gameRepository
    .update(
      {
        objectID: objectId,
      },
      {
        shop,
        status: null,
        isDeleted: false,
      }
    )
    .then(async ({ affected }) => {
      if (!affected) {
        const steamGame = await steamGamesWorker.run(Number(objectId), {
          name: "getById",
        });

        const iconUrl = steamGame?.clientIcon
          ? steamUrlBuilder.icon(objectId, steamGame.clientIcon)
          : null;

        const game: Game = {
          title,
          iconUrl,
          objectId,
          shop,
        };

        await gamesSublevel.put(levelKeys.game(shop, objectId), game);
      }

      updateLocalUnlockedAchivements(game!);

      createGame(game!).catch(() => {});
    });
};

registerEvent("addGameToLibrary", addGameToLibrary);
