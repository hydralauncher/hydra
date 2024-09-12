import { shuffle } from "lodash-es";

import { getSteam250List } from "@main/services";

import { registerEvent } from "../register-event";
import { getSteamGameById } from "../helpers/search-games";
import type { Steam250Game } from "@types";

const state = { games: Array<Steam250Game>(), index: 0 };

const filterGames = async (games: Steam250Game[]) => {
  const results: Steam250Game[] = [];

  for (const game of games) {
    const steamGame = await getSteamGameById(game.objectID);

    if (steamGame) {
      if (steamGame.repacks.length) {
        results.push(game);
      }
    }
  }

  return results;
};

const getRandomGame = async (_event: Electron.IpcMainInvokeEvent) => {
  if (state.games.length == 0) {
    const steam250List = await getSteam250List();

    const filteredSteam250List = await filterGames(steam250List);

    state.games = shuffle(filteredSteam250List);
  }

  if (state.games.length == 0) {
    return "";
  }

  state.index += 1;

  if (state.index == state.games.length) {
    state.index = 0;
    state.games = shuffle(state.games);
  }

  return state.games[state.index];
};

registerEvent("getRandomGame", getRandomGame);
