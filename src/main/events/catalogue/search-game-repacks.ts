import { searchRepacks } from "../helpers/search-games";
import { registerEvent } from "../register-event";

const searchGameRepacks = (
  _event: Electron.IpcMainInvokeEvent,
  query: string
) => {
  return searchRepacks(query);
};

registerEvent("searchGameRepacks", searchGameRepacks);
