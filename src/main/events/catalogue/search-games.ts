import { registerEvent } from "../register-event";
import { getSteamGameById } from "../helpers/search-games";
import { CatalogueEntry } from "@types";
import { HydraApi } from "@main/services";

const searchGamesEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string
): Promise<CatalogueEntry[]> => {
  const games = await HydraApi.get<
    { objectId: string; title: string; shop: string }[]
  >("/games/search", { title: query, take: 12, skip: 0 }, { needsAuth: false });

  const steamGames = await Promise.all(
    games.map((game) => getSteamGameById(game.objectId))
  );
  const filteredGames = steamGames.filter(
    (game) => game !== null
  ) as CatalogueEntry[];

  return filteredGames;
};

registerEvent("searchGames", searchGamesEvent);
