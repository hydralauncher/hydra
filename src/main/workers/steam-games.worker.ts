import { SteamGame } from "@types";
import { orderBy, slice } from "lodash-es";
import flexSearch from "flexsearch";
import fs from "node:fs";

import { formatName } from "@shared";
import { workerData } from "node:worker_threads";

const steamGamesIndex = new flexSearch.Index({
  tokenize: "reverse",
});

const { steamGamesPath } = workerData;

const data = fs.readFileSync(steamGamesPath, "utf-8");

const steamGames = JSON.parse(data) as SteamGame[];

for (let i = 0; i < steamGames.length; i++) {
  const steamGame = steamGames[i];

  const formattedName = formatName(steamGame.name);

  steamGamesIndex.add(i, formattedName);
}

export const search = (options: flexSearch.SearchOptions) => {
  const results = steamGamesIndex.search(options);
  const games = results.map((index) => steamGames[index]);

  return orderBy(games, ["name"], ["asc"]);
};

export const getById = (id: number) =>
  steamGames.find((game) => game.id === id);

export const list = ({ limit, offset }: { limit: number; offset: number }) =>
  slice(steamGames, offset, offset + limit);
