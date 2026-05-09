import { SteamSyncCancellation } from "@main/services/steam-sync-cancellation";
import { registerEvent } from "../register-event";

const cancelSteamSync = (
  _event: Electron.IpcMainInvokeEvent,
  type: "achievements" | "library"
) => {
  SteamSyncCancellation.request(type);
};

registerEvent("cancelSteamSync", cancelSteamSync);
