import { registerEvent } from "../register-event";

import type { GameShop } from "@types";

import { steamGamesWorker } from "@main/workers";
import { createGame } from "@main/services/library-sync";
import { steamUrlBuilder } from "@shared";
import { updateLocalUnlockedAchievements } from "@main/services/achievements/update-local-unlocked-achivements";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  let game = await gamesSublevel.get(gameKey);

  if (game) {
    await downloadsSublevel.del(gameKey);

    await gamesSublevel.put(gameKey, {
      ...game,
      isDeleted: false,
    });
  } else {
    const steamGame = await steamGamesWorker.run(Number(objectId), {
      name: "getById",
    });

    const iconUrl = steamGame?.clientIcon
      ? steamUrlBuilder.icon(objectId, steamGame.clientIcon)
      : null;

    game = {
      title,
      iconUrl,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
    };

    await gamesSublevel.put(levelKeys.game(shop, objectId), game);
  }

  await createGame(game).catch(() => {});

  updateLocalUnlockedAchievements(game);
};

registerEvent("addGameToLibrary", addGameToLibrary);
