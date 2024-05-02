import flexSearch from "flexsearch";
import { orderBy } from "lodash-es";

import type { GameRepack, GameShop, CatalogueEntry } from "@types";

import { formatName, getSteamAppAsset, repackerFormatter } from "@main/helpers";
import { stateManager } from "@main/state-manager";

const { Index } = flexSearch;
const repacksIndex = new Index();
const steamGamesIndex = new Index();

const repacks = stateManager.getValue("repacks");
const steamGames = stateManager.getValue("steamGames");

for (let i = 0; i < repacks.length; i++) {
  const repack = repacks[i];
  const formatter =
    repackerFormatter[repack.repacker as keyof typeof repackerFormatter];

  repacksIndex.add(i, formatName(formatter(repack.title)));
}

for (let i = 0; i < steamGames.length; i++) {
  const steamGame = steamGames[i];
  steamGamesIndex.add(i, formatName(steamGame.name));
}

export const searchRepacks = (title: string): GameRepack[] => {
  return orderBy(
    repacksIndex
      .search(formatName(title))
      .map((index) => repacks.at(index as number)!),
    ["uploadDate"],
    "desc"
  );
};

export interface SearchGamesArgs {
  query?: string;
  take?: number;
  skip?: number;
}

export const searchGames = ({
  query,
  take,
  skip,
}: SearchGamesArgs): CatalogueEntry[] => {
  const results = steamGamesIndex
    .search(formatName(query || ""), { limit: take, offset: skip })
    .map((index) => {
      const result = steamGames.at(index as number)!;

      return {
        objectID: String(result.id),
        title: result.name,
        shop: "steam" as GameShop,
        cover: getSteamAppAsset("library", String(result.id)),
        repacks: searchRepacks(result.name),
      };
    });

  return orderBy(
    results,
    [({ repacks }) => repacks.length, "repacks"],
    ["desc"]
  );
};
