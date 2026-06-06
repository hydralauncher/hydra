import { searchGames } from "@main/services";
import { registerEvent } from "../register-event";

const searchCrackCalendar = async (
  _event: Electron.IpcMainInvokeEvent,
  query: string
) => {
  return searchGames(query);
};

registerEvent("search-crack-calendar", searchCrackCalendar, {
  needsAuth: false,
});
