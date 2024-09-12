import type { GameShop, CatalogueEntry, SteamGame } from "@types";

import { steamGamesWorker } from "@main/workers";
import { RepacksManager } from "@main/services";
import { steamUrlBuilder } from "@shared";

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
  cover: steamUrlBuilder.library(String(game.id)),
  repacks: [],
});

export const getSteamGameById = async (
  objectId: string
): Promise<CatalogueEntry | null> => {
  const steamGame = await steamGamesWorker.run(Number(objectId), {
    name: "getById",
  });

  if (!steamGame) return null;

  const catalogueEntry = convertSteamGameToCatalogueEntry(steamGame);

  const result = RepacksManager.findRepacksForCatalogueEntry(catalogueEntry);

  return result;
};
