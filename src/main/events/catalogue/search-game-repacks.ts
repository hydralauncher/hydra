import { RepacksManager } from "@main/services";
import { registerEvent } from "../register-event";

const searchGameRepacks = (
  _event: Electron.IpcMainInvokeEvent,
  query: string
) => RepacksManager.search({ query });

registerEvent("searchGameRepacks", searchGameRepacks);
