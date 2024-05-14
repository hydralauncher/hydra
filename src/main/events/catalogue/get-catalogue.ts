import { formatName, getSteamAppAsset, repackerFormatter } from "@main/helpers";
import type { CatalogueCategory, CatalogueEntry, GameShop } from "@types";

import { stateManager } from "@main/state-manager";
import { searchGames, searchRepacks } from "../helpers/search-games";
import { registerEvent } from "../register-event";
import { requestSteam250 } from "@main/services";

const repacks = stateManager.getValue("repacks");

const getStringForLookup = (index: number): string => {
  const repack = repacks[index];
  const formatter =
    repackerFormatter[repack.repacker as keyof typeof repackerFormatter];

  return formatName(formatter(repack.title));
};

const resultSize = 12;

const getCatalogue = async (
  _event: Electron.IpcMainInvokeEvent,
  category: CatalogueCategory
) => {
  if (!repacks.length) return [];

  if (category === "trending") {
    return getTrendingCatalogue(resultSize);
  }

  return getRecentlyAddedCatalogue(resultSize);
};

const getTrendingCatalogue = async (
  resultSize: number
): Promise<CatalogueEntry[]> => {
  const results: CatalogueEntry[] = [];
  const trendingGames = await requestSteam250("/90day");

  for (
    let i = 0;
    i < trendingGames.length && results.length < resultSize;
    i++
  ) {
    if (!trendingGames[i]) continue;

    const { title, objectID } = trendingGames[i]!;
    const repacks = searchRepacks(title);

    if (title && repacks.length) {
      const catalogueEntry = {
        objectID,
        title,
        shop: "steam" as GameShop,
        cover: getSteamAppAsset("library", objectID),
      };

      results.push({ ...catalogueEntry, repacks });
    }
  }
  return results;
};

const getRecentlyAddedCatalogue = async (
  resultSize: number
): Promise<CatalogueEntry[]> => {
  const results: CatalogueEntry[] = [];

  for (let i = 0; results.length < resultSize; i++) {
    const stringForLookup = getStringForLookup(i);

    if (!stringForLookup) {
      i++;
      continue;
    }

    const games = searchGames({ query: stringForLookup });

    for (const game of games) {
      const isAlreadyIncluded = results.some(
        (result) => result.objectID === game?.objectID
      );

      if (!game || !game.repacks.length || isAlreadyIncluded) {
        continue;
      }

      results.push(game);
    }
  }

  return results.slice(0, resultSize);
};

registerEvent("getCatalogue", getCatalogue);
