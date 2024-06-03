import { registerEvent } from "../register-event";
import { repacksWorker } from "@main/workers";

const searchGameRepacks = (
  _event: Electron.IpcMainInvokeEvent,
  query: string
) => repacksWorker.run({ query }, { name: "search" });

registerEvent("searchGameRepacks", searchGameRepacks);
