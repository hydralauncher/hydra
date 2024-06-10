import { registerEvent } from "../register-event";
import { searchSteamGames } from "../helpers/search-games";
import { CatalogueEntry } from "@types";

const searchGamesEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string
): Promise<CatalogueEntry[]> => searchSteamGames({ query, limit: 12 });

registerEvent("searchGames", searchGamesEvent);
