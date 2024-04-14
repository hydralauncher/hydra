import { formatName, repackerFormatter } from "@main/helpers";
import { getTrendingGames } from "@main/services";
import type { CatalogueCategory, CatalogueEntry } from "@types";

import { stateManager } from "@main/state-manager";
import { searchGames } from "../helpers/search-games";
import { registerEvent } from "../register-event";

const repacks = stateManager.getValue("repacks");

const getCatalogue = async (
  _event: Electron.IpcMainInvokeEvent,
  category: CatalogueCategory
) => {
  const trendingGames = await getTrendingGames();

  let i = 0;
  const results: CatalogueEntry[] = [];

  const getStringForLookup = (index: number) => {
    if (category === "trending") return trendingGames[index];

    const repack = repacks[index];
    const formatter =
      repackerFormatter[repack.repacker as keyof typeof repackerFormatter];

    return formatName(formatter(repack.title));
  };

  if (!repacks.length) return [];

  const resultSize = 12;
  const requestSize = resultSize * 2;
  let lookupRequest = [];

  while (results.length < resultSize) {
    const stringForLookup = getStringForLookup(i);

    if (!stringForLookup) {
      i++;
      continue;
    }

    lookupRequest.push(searchGames(stringForLookup));

    i++;

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
