import type { CatalogueEntry } from "@types";

import { registerEvent } from "../register-event";
import { steamGamesWorker } from "@main/workers";
import { convertSteamGameToCatalogueEntry } from "../helpers/search-games";
import { RepacksManager } from "@main/services";

const getGames = async (
  _event: Electron.IpcMainInvokeEvent,
  take = 12,
  cursor = 0
): Promise<{ results: CatalogueEntry[]; cursor: number }> => {
  const steamGames = await steamGamesWorker.run(
    { limit: take, offset: cursor },
    { name: "list" }
  );

  const entries = RepacksManager.findRepacksForCatalogueEntries(
    steamGames.map((game) => convertSteamGameToCatalogueEntry(game))
  );

  return {
    results: entries,
    cursor: cursor + entries.length,
  };
};

registerEvent("getGames", getGames);
