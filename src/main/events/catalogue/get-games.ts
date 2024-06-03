import type { CatalogueEntry } from "@types";

import { registerEvent } from "../register-event";
import { convertSteamGameToCatalogueEntry } from "../helpers/search-games";
import { steamGamesWorker } from "@main/workers";

const getGames = async (
  _event: Electron.IpcMainInvokeEvent,
  take = 12,
  cursor = 0
): Promise<{ results: CatalogueEntry[]; cursor: number }> => {
  const results = await steamGamesWorker.run(
    { limit: take, offset: cursor },
    { name: "list" }
  );

  return {
    results: results.map((result) => convertSteamGameToCatalogueEntry(result)),
    cursor: cursor + results.length,
  };
};

registerEvent("getGames", getGames);
