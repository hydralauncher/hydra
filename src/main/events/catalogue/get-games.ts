import type { CatalogueEntry } from "@types";

import { registerEvent } from "../register-event";
import { steamGamesWorker } from "@main/workers";

const getGames = async (
  _event: Electron.IpcMainInvokeEvent,
  take = 12,
  cursor = 0
): Promise<{ results: CatalogueEntry[]; cursor: number }> => {
  const steamGames = await steamGamesWorker.run(
    { limit: take, offset: cursor },
    { name: "list" }
  );

  return {
    results: steamGames,
    cursor: cursor + steamGames.length,
  };
};

registerEvent("getGames", getGames);
