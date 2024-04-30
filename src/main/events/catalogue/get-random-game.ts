import { shuffle } from "lodash-es";

import { Steam250Game, getSteam250List } from "@main/services";

import { registerEvent } from "../register-event";
import { searchGames, searchRepacks } from "../helpers/search-games";

const state = { games: Array<Steam250Game>(), index: 0 };

const getRandomGame = async (_event: Electron.IpcMainInvokeEvent) => {
  if (state.games.length == 0) {
    const steam250List = await getSteam250List();

    const filteredSteam250List = steam250List.filter((game) => {
      const repacks = searchRepacks(game.title);
      const catalogue = searchGames({ query: game.title });

      return repacks.length && catalogue.length;
    });

    state.games = shuffle(filteredSteam250List);
  }

  if (state.games.length == 0) {
    return "";
  }

  const resultObjectId = state.games[state.index].objectID;

  state.index += 1;

  if (state.index == state.games.length) {
    state.index = 0;
    state.games = shuffle(state.games);
  }

  return resultObjectId;
};

registerEvent(getRandomGame, {
  name: "getRandomGame",
});
