import type { CatalogueEntry } from "@types";

import { registerEvent } from "../register-event";
import { repacksWorker, steamGamesWorker } from "@main/workers";
import { convertSteamGameToCatalogueEntry } from "../helpers/search-games";

const getGames = async (
  _event: Electron.IpcMainInvokeEvent,
  take = 12,
  cursor = 0
): Promise<{ results: CatalogueEntry[]; cursor: number }> => {
  const steamGames = await steamGamesWorker.run(
    { limit: take, offset: cursor },
    { name: "list" }
  );

  const entries = await repacksWorker.run(
    steamGames.map((game) => convertSteamGameToCatalogueEntry(game)),
    {
      name: "findRepacksForCatalogueEntries",
    }
  );

  return {
    results: entries,
    cursor: cursor + entries.length,
  };
};

registerEvent("getGames", getGames);
