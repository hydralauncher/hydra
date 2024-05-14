import type { CatalogueEntry, GameShop } from "@types";

import { registerEvent } from "../register-event";
import { searchRepacks } from "../helpers/search-games";
import { stateManager } from "@main/state-manager";
import { getSteamAppAsset } from "@main/helpers";

const steamGames = stateManager.getValue("steamGames");

const getGames = async (
  _event: Electron.IpcMainInvokeEvent,
  take = 12,
  cursor = 0
): Promise<{ results: CatalogueEntry[]; cursor: number }> => {
  const results: CatalogueEntry[] = [];

  let i = 0 + cursor;

  while (results.length < take) {
    const game = steamGames[i];
    const repacks = searchRepacks(game.name);

    if (repacks.length) {
      results.push({
        objectID: String(game.id),
        title: game.name,
        shop: "steam" as GameShop,
        cover: getSteamAppAsset("library", String(game.id)),
        repacks,
      });
    }

    i++;
  }

  return { results, cursor: i };
};

registerEvent("getGames", getGames);
