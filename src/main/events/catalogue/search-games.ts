import { registerEvent } from "../register-event";
import { searchGames } from "../helpers/search-games";
import { CatalogueEntry, PaginationArgs } from "@types";
import { defaults } from "lodash-es";

const DEFAULT_SEARCH_ARGS: PaginationArgs = {
  take: 12,
  skip: 0,
};

const searchGamesEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string,
  options?: Partial<PaginationArgs>
): Promise<CatalogueEntry[]> => {
  return searchGames({ query, ...defaults(options, DEFAULT_SEARCH_ARGS) });
};

registerEvent("searchGames", searchGamesEvent);
