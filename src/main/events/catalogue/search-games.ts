import { registerEvent } from "../register-event";
import { searchGames } from "../helpers/search-games";
import { CatalogueEntry } from "@types";

const searchGamesEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string
): Promise<CatalogueEntry[]> => {
  return Promise.all(searchGames({ query, take: 12 }));
};

registerEvent(searchGamesEvent, {
  name: "searchGames",
  memoize: true,
});
