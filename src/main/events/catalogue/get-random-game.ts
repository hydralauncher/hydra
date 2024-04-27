import shuffle from "lodash/shuffle";

import { Steam250Game, getSteam250List } from "@main/services";

import { registerEvent } from "../register-event";
import { searchGames, searchRepacks } from "../helpers/search-games";
import { formatName } from "@main/helpers";

let gamesList: Steam250Game[] = [];
let nextGameIndex = 0;

const getRandomGame = async (_event: Electron.IpcMainInvokeEvent) => {
  if (gamesList.length == 0) {
    console.log("fetching steam 250 pages");
    gamesList = shuffle(await getSteam250List());
  } else {
    console.log("getting cached list");
  }

  let resultObjectId = "";

  while (!resultObjectId) {
    const game = gamesList[nextGameIndex];
    const repacks = searchRepacks(formatName(game.title));

    if (repacks.length) {
      const catalogueResults = await searchGames({ query: game.title });

      if (catalogueResults.length) {
        resultObjectId = catalogueResults[0].objectID;
      }
    }
    nextGameIndex += 1;

    if (nextGameIndex == gamesList.length) {
      nextGameIndex = 0;
      gamesList = shuffle(gamesList);
    }
  }

  return resultObjectId;
};

registerEvent(getRandomGame, {
  name: "getRandomGame",
});
