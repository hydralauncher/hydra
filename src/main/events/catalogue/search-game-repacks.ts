import { SearchEngine } from "@main/services";
import { registerEvent } from "../register-event";

const searchGameRepacks = (
  _event: Electron.IpcMainInvokeEvent,
  query: string
) => SearchEngine.searchRepacks(query);

registerEvent("searchGameRepacks", searchGameRepacks);
