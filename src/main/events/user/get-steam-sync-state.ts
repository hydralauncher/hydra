import { registerEvent } from "../register-event";
import { steamSyncOrchestrator } from "@main/services/steam-integration/steam-sync-orchestrator";

const getSteamSyncState = async () => steamSyncOrchestrator.getState();

registerEvent("getSteamSyncState", getSteamSyncState);
