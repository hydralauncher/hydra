import { orderBy } from "lodash-es";
import flexSearch from "flexsearch";

import type { GameShop, CatalogueEntry, SteamGame } from "@types";

import { getSteamAppAsset } from "@main/helpers";
import { SearchEngine } from "@main/services";
import { steamGamesWorker } from "@main/workers";

export interface SearchGamesArgs {
  query?: string;
  take?: number;
  skip?: number;
}

export const convertSteamGameToCatalogueEntry = (
  result: SteamGame
): CatalogueEntry => {
  return {
    objectID: String(result.id),
    title: result.name,
    shop: "steam" as GameShop,
    cover: getSteamAppAsset("library", String(result.id)),
    repacks: SearchEngine.searchRepacks(result.name),
  };
};

export const searchSteamGames = async (
  options: flexSearch.SearchOptions
): Promise<CatalogueEntry[]> => {
  const steamGames = await steamGamesWorker.run(options, { name: "search" });

  return orderBy(
    steamGames.map((result) => convertSteamGameToCatalogueEntry(result)),
    [({ repacks }) => repacks.length, "repacks"],
    ["desc"]
  );
};
