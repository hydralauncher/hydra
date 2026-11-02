import { registerEvent } from "../register-event";
import { steamSyncOrchestrator } from "@main/services/steam-integration/steam-sync-orchestrator";
import type { SteamSyncRunStatus } from "@types";

const reconcileSteamSyncRun = async (
  _event: Electron.IpcMainInvokeEvent,
  latestSyncRunStatus: SteamSyncRunStatus | null
) => steamSyncOrchestrator.reconcilePersistedRun(latestSyncRunStatus);

registerEvent("reconcileSteamSyncRun", reconcileSteamSyncRun);
