import { gameRepository } from "@main/repository";

import { registerEvent } from "../register-event";

import type { GameShop } from "@types";
import { getFileBase64, getSteamAppAsset } from "@main/helpers";
import { stateManager } from "@main/state-manager";

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  objectID: string,
  title: string,
  shop: GameShop,
  executablePath: string | null
) => {
  return gameRepository
    .update(
      {
        objectID,
      },
      {
        shop,
        status: null,
        executablePath,
        isDeleted: false,
      }
    )
    .then(async ({ affected }) => {
      if (!affected) {
        const steamGame = stateManager
          .getValue("steamGames")
          .find((game) => game.id === Number(objectID));

        const iconUrl = steamGame?.clientIcon
          ? getSteamAppAsset("icon", objectID, steamGame.clientIcon)
          : null;

        await gameRepository
          .insert({
            title,
            iconUrl,
            objectID,
            shop,
            executablePath,
          })
          .then(() => {
            if (iconUrl) {
              getFileBase64(iconUrl).then((base64) =>
                gameRepository.update({ objectID }, { iconUrl: base64 })
              );
            }
          });
      }
    });
};

registerEvent("addGameToLibrary", addGameToLibrary);
