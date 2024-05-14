import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getFileBase64 } from "@main/helpers";
import { getSteamGameIconUrl } from "@main/services";

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  objectID: string,
  title: string,
  gameShop: GameShop,
  executablePath: string | null
) => {
  return gameRepository
    .update(
      {
        objectID,
      },
      {
        shop: gameShop,
        status: null,
        executablePath,
        isDeleted: false,
      }
    )
    .then(async ({ affected }) => {
      if (!affected) {
        const iconUrl = await getFileBase64(
          await getSteamGameIconUrl(objectID)
        );

        await gameRepository.insert({
          title,
          iconUrl,
          objectID,
          shop: gameShop,
          executablePath,
        });
      }
    });
};

registerEvent("addGameToLibrary", addGameToLibrary);
