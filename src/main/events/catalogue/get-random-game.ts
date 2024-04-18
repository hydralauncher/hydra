import shuffle from "lodash/shuffle";

import { getRandomSteam250List } from "@main/services";

import { registerEvent } from "../register-event";
import { searchGames, searchRepacks } from "../helpers/search-games";
import { formatName } from "@main/helpers";

const getRandomGame = async (_event: Electron.IpcMainInvokeEvent) => {
  return getRandomSteam250List().then(async (games) => {
    const shuffledList = shuffle(games);

    for (const game of shuffledList) {
      const repacks = searchRepacks(formatName(game.title));

      if (repacks.length) {
        const results = await searchGames({ query: game.title });

        if (results.length) {
          return results[0].objectID;
        }
      }
    }
  });
};

registerEvent(getRandomGame, {
  name: "getRandomGame",
});
