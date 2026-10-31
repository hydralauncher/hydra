import type { SteamIntegrationStatus, SteamSyncState } from "@types";

export type SteamIntegrationViewState =
  | "disconnected"
  | "connected"
  | "reconnect-required"
  | "snapshot-preserved";

const getSteamIntegrationViewState = (
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

export const getSteamIntegrationPresentation = (
  integration: SteamIntegrationStatus,
  syncState: SteamSyncState
) => {
  const viewState = getSteamIntegrationViewState(integration, syncState);

  switch (viewState) {
    case "reconnect-required":
      return {
        viewState,
        statusKey: "steam_status_reconnect_required" as const,
        statusTone: "warning" as const,
      };
    case "connected":
      return {
        viewState,
        statusKey: "steam_status_connected" as const,
        statusTone: "success" as const,
      };
    case "snapshot-preserved":
      return {
        viewState,
        statusKey: "steam_status_snapshot_preserved" as const,
        statusTone: "warning" as const,
      };
    case "disconnected":
      return {
        viewState,
        statusKey: "integration_status_not_connected" as const,
        statusTone: "neutral" as const,
      };
  }
};
