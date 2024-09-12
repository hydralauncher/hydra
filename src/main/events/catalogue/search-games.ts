import { registerEvent } from "../register-event";
import { convertSteamGameToCatalogueEntry } from "../helpers/search-games";
import { CatalogueEntry } from "@types";
import { HydraApi, RepacksManager } from "@main/services";

const searchGamesEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string
): Promise<CatalogueEntry[]> => {
  const games = await HydraApi.get<
    { objectId: string; title: string; shop: string }[]
  >("/games/search", { title: query, take: 12, skip: 0 }, { needsAuth: false });

  const steamGames = games.map((game) => {
    return convertSteamGameToCatalogueEntry({
      id: Number(game.objectId),
      name: game.title,
      clientIcon: null,
    });
  });

  return RepacksManager.findRepacksForCatalogueEntries(steamGames);
};

registerEvent("searchGames", searchGamesEvent);
