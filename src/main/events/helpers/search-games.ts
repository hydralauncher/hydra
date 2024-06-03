import { orderBy } from "lodash-es";
import flexSearch from "flexsearch";

import type { GameShop, CatalogueEntry, SteamGame } from "@types";

import { getSteamAppAsset } from "@main/helpers";
import { steamGamesWorker } from "@main/workers";
import { RepacksManager } from "@main/services";

export interface SearchGamesArgs {
  query?: string;
  take?: number;
  skip?: number;
}

export const convertSteamGameToCatalogueEntry = (
  game: SteamGame
): CatalogueEntry => ({
  objectID: String(game.id),
  title: game.name,
  shop: "steam" as GameShop,
  cover: getSteamAppAsset("library", String(game.id)),
  repacks: [],
});

export const searchSteamGames = async (
  options: flexSearch.SearchOptions
): Promise<CatalogueEntry[]> => {
  const steamGames = (await steamGamesWorker.run(options, {
    name: "search",
  })) as SteamGame[];

  const result = RepacksManager.findRepacksForCatalogueEntries(
    steamGames.map((game) => convertSteamGameToCatalogueEntry(game))
  );

  return orderBy(
    result,
    [({ repacks }) => repacks.length, "repacks"],
    ["desc"]
  );
};
