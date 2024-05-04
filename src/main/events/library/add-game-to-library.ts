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
  executablePath: string
) => {
  const game = await gameRepository.findOne({
    where: {
      objectID,
    },
  });

  if (game) {
    return gameRepository.update(
      {
        id: game.id,
      },
      {
        shop: gameShop,
        executablePath,
        isDeleted: false,
      }
    );
  } else {
    const iconUrl = await getFileBase64(await getSteamGameIconUrl(objectID));

    return gameRepository.insert({
      title,
      iconUrl,
      objectID,
      shop: gameShop,
      executablePath,
    });
  }
};

registerEvent(addGameToLibrary, {
  name: "addGameToLibrary",
});
