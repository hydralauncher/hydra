import type { SteamIntegrationStatus, SteamSyncState } from "@types";

export type SteamIntegrationViewState =
  | "disconnected"
  | "connected"
  | "reconnect-required"
  | "snapshot-preserved";

export const getSteamIntegrationViewState = (
  integration: SteamIntegrationStatus,
  syncState: SteamSyncState
): SteamIntegrationViewState => {
  if (!integration.connected) {
    return integration.snapshotPreserved
      ? "snapshot-preserved"
      : "disconnected";
  }

  if (syncState.status === "idle" && syncState.requiresReconnect === true) {
    return "reconnect-required";
  }

  return "connected";
};
