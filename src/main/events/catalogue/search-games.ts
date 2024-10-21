import { registerEvent } from "../register-event";
import { convertSteamGameToCatalogueEntry } from "../helpers/search-games";
import type { CatalogueEntry } from "@types";
import { HydraApi } from "@main/services";

const searchGamesEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string
): Promise<CatalogueEntry[]> => {
  const games = await HydraApi.get<
    { objectId: string; title: string; shop: string }[]
  >("/games/search", { title: query, take: 12, skip: 0 }, { needsAuth: false });

  return games.map((game) => {
    return convertSteamGameToCatalogueEntry({
      id: Number(game.objectId),
      name: game.title,
      clientIcon: null,
    });
  });
};

registerEvent("searchGames", searchGamesEvent);
