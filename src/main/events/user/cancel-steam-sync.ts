import { registerEvent } from "../register-event";
import { steamSyncOrchestrator } from "@main/services/steam-integration/steam-sync-orchestrator";

const cancelSteamSync = async () => steamSyncOrchestrator.cancel();

registerEvent("cancelSteamSync", cancelSteamSync);
