import { registerEvent } from "../register-event";
import { searchGames } from "../helpers/search-games";
import { CatalogueEntry } from "@types";

const PAGE_SIZE = 12;

const searchGamesEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string,
  page = 0
): Promise<CatalogueEntry[]> => {
  return searchGames({ query, take: PAGE_SIZE, skip: page * PAGE_SIZE });
};

registerEvent(searchGamesEvent, {
  name: "searchGames",
  memoize: true,
});
