import { formatName, getSteamAppAsset, repackerFormatter } from "@main/helpers";
import { getTrendingGames } from "@main/services";
import type { CatalogueCategory, CatalogueEntry, GameShop } from "@types";

import { stateManager } from "@main/state-manager";
import { searchGames, searchRepacks } from "../helpers/search-games";
import { registerEvent } from "../register-event";

const repacks = stateManager.getValue("repacks");

const getCatalogue = async (
  _event: Electron.IpcMainInvokeEvent,
  category: CatalogueCategory
) => {
  const getStringForLookup = (index: number) => {
    const repack = repacks[index];
    const formatter =
      repackerFormatter[repack.repacker as keyof typeof repackerFormatter];

    return formatName(formatter(repack.title));
  };

  if (!repacks.length) return [];

  const resultSize = 12;
  const requestSize = resultSize;

  if (category === "trending") {
    return searchTrending(resultSize);
  } else {
    return searchRecentlyAdded(resultSize, requestSize, getStringForLookup);
  }
};

const searchTrending = async (
  resultSize: number
): Promise<CatalogueEntry[]> => {
  const results: CatalogueEntry[] = [];
  const trendingGames = await getTrendingGames();
  for (
    let i = 0;
    i < trendingGames.length && results.length < resultSize;
    i++
  ) {
    if (!trendingGames[i]) continue;

    const { title, objectID } = trendingGames[i];
    const repacks = searchRepacks(title);

    if (title && repacks.length) {
      const catalogueEntry = {
        objectID,
        title,
        shop: "steam" as GameShop,
        cover: getSteamAppAsset("library", objectID),
      };
      repacks.sort(
        (a, b) =>
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      );
      results.push({ ...catalogueEntry, repacks });
    }
  }
  return results;
};

const searchRecentlyAdded = async (
  resultSize: number,
  requestSize: number,
  getStringForLookup: { (index: number): any; (arg0: any): any }
): Promise<CatalogueEntry[]> => {
  let lookupRequest = [];
  const results: CatalogueEntry[] = [];

  for (let i = 0; results.length < resultSize; i++) {
    const stringForLookup = getStringForLookup(i);

    if (!stringForLookup) {
      i++;
      continue;
    }

    lookupRequest.push(searchGames(stringForLookup));

    if (lookupRequest.length < requestSize) {
      continue;
    }

    const games = (await Promise.all(lookupRequest)).map((value) =>
      value.at(0)
    );

    for (const game of games) {
      const isAlreadyIncluded = results.some(
        (result) => result.objectID === game?.objectID
      );

      if (!game || !game.repacks.length || isAlreadyIncluded) {
        continue;
      }

      results.push(game);
    }
    lookupRequest = [];
  }

  return results.slice(0, resultSize);
};

registerEvent(getCatalogue, {
  name: "getCatalogue",
  memoize: true,
});
