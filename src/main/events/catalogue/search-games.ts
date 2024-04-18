import { registerEvent } from "../register-event";
import { searchGames } from "../helpers/search-games";

registerEvent(
  (_event: Electron.IpcMainInvokeEvent, query: string) =>
    searchGames({ query, take: 12 }),
  {
    name: "searchGames",
    memoize: true,
  }
);
