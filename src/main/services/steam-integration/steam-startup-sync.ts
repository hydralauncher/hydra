import type { SteamIntegrationStatus } from "@types";

import { HydraApi } from "../hydra-api";
import { steamSyncLogger } from "../logger";
import { createSteamStartupSync } from "./steam-startup-sync-core";
import { steamSyncOrchestrator } from "./steam-sync-orchestrator";

const INTEGRATION_ENDPOINT = "/profile/integrations/steam";

const startupSync = createSteamStartupSync({
  isLoggedIn: () => HydraApi.isLoggedIn(),
  getStatus: () => HydraApi.get<SteamIntegrationStatus>(INTEGRATION_ENDPOINT),
  startSync: (origin) => steamSyncOrchestrator.start(origin),
  logError: (message, error) => steamSyncLogger.error(message, error),
});

export const startSteamSyncOnStartup = () => startupSync.run();
export const resetSteamStartupSync = () => startupSync.reset();
