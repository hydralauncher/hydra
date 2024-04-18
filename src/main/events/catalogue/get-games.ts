import type { CatalogueEntry } from "@types";

import { registerEvent } from "../register-event";
import { searchGames } from "../helpers/search-games";
import slice from "lodash/slice";

const getGames = async (
  _event: Electron.IpcMainInvokeEvent,
  take?: number,
  prevCursor = 0
): Promise<{ results: CatalogueEntry[]; cursor: number }> => {
  let results: CatalogueEntry[] = [];
  let i = 0;

  const batchSize = 100;

  while (results.length < take) {
    const games = await searchGames({
      take: batchSize,
      skip: (i + prevCursor) * batchSize,
    });
    results = [...results, ...games.filter((game) => game.repacks.length)];
    i++;
  }

  return { results: slice(results, 0, take), cursor: prevCursor + i };
};

registerEvent(getGames, {
  name: "getGames",
  memoize: true,
});
