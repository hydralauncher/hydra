import { registerEvent } from "../register-event";
import { steamSyncOrchestrator } from "@main/services/steam-integration/steam-sync-orchestrator";

const startSteamSync = async () => steamSyncOrchestrator.start();

registerEvent("startSteamSync", startSteamSync);
