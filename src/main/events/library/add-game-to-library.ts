import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";

import { steamGamesWorker } from "@main/workers";
import { createGame } from "@main/services/library-sync";
import { steamUrlBuilder } from "@shared";
import { updateLocalUnlockedAchivements } from "@main/services/achievements/update-local-unlocked-achivements";

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  title: string,
  shop: GameShop
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

        await gameRepository.insert({
          title,
          iconUrl,
          objectID: objectId,
          shop,
        });
      }

      const game = await gameRepository.findOne({
        where: { objectID: objectId },
      });

      updateLocalUnlockedAchivements(game!);

      createGame(game!).catch(() => {});
    });
};

registerEvent("addGameToLibrary", addGameToLibrary);
