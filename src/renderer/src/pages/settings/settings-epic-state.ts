import type { EpicConnectionState, EpicErrorCode } from "@types";

const EPIC_ERROR_TRANSLATIONS: Record<EpicErrorCode, string> = {
  "hydra-auth-required": "epic_error_hydra_auth",
  "unsupported-platform": "epic_error_platform",
  "unsupported-architecture": "epic_error_platform",
  "legendary-missing": "epic_error_legendary",
  "legendary-unavailable": "epic_error_legendary",
  "api-unavailable": "epic_error_api",
  network: "epic_error_network",
  "invalid-account-data": "epic_error_account_data",
  "account-in-use": "epic_error_account_in_use",
  "different-account": "epic_error_different_account",
  "stale-connection": "epic_error_stale_connection",
  "invalid-response": "epic_error_response",
  "persistence-failed": "epic_error_persistence",
  "cleanup-failed": "epic_error_cleanup",
  "oauth-client-mismatch": "epic_error_client",
  "operation-cancelled": "epic_error_cancelled",
  "operation-in-progress": "epic_error_in_progress",
  "invalid-operation": "epic_error_cancelled",
  "auth-failed": "epic_error_auth",
  timeout: "epic_error_timeout",
  "sync-active": "epic_sync_in_progress",
  "snapshot-invalid": "epic_sync_invalid",
  "snapshot-too-large": "epic_sync_too_large",
  "source-permission": "epic_sync_permission",
  "rate-limit": "epic_sync_rate_limit",
  "merge-failed": "epic_sync_merge_pending",
  "session-expired": "epic_reconnect_description",
};

export const getEpicErrorTranslation = (error: EpicErrorCode): string =>
  EPIC_ERROR_TRANSLATIONS[error] ?? "epic_error_auth";

export const isEpicStateForUser = (
  state: EpicConnectionState,
  hydraUserId: string | null
): boolean =>
  state.hydraUserId === hydraUserId ||
  (!state.hydraLoggedIn && state.hydraUserId === null);

export const getEpicAuthFailure = (
  previous: EpicConnectionState | null,
  next: EpicConnectionState
): EpicErrorCode | null => {
  if (
    !previous?.operation ||
    previous.operation.status === "disconnecting" ||
    previous.hydraUserId !== next.hydraUserId ||
    !next.hydraLoggedIn ||
    next.operation ||
    !next.error ||
    next.error === "operation-cancelled"
  )
    return null;

  return next.error;
};

export const getEpicIntegrationPresentation = (
  state: EpicConnectionState | null,
  hydraLoggedIn: boolean
) => {
  const connected = state?.connection?.connected === true;
  const busy = state?.operation != null;
  const requiresReconnect = connected && state?.sessionState !== "ready";
  const canAuthenticate =
    hydraLoggedIn &&
    state?.availability.available === true &&
    state.error !== "api-unavailable" &&
    !busy;

  if (!hydraLoggedIn || state?.hydraLoggedIn === false) {
    return {
      statusKey: "integration_status_not_connected",
      statusTone: "neutral" as const,
      requiresReconnect: false,
      canAuthenticate: false,
      canDisconnect: false,
    };
  }

  const actions = {
    requiresReconnect,
    canAuthenticate,
    canDisconnect: connected && !busy,
  };

  if (state?.operation) {
    let statusKey = "epic_status_connecting";
    if (state.operation.status === "awaiting-login") {
      statusKey = "epic_status_awaiting_login";
    } else if (state.operation.status === "disconnecting") {
      statusKey = "epic_status_disconnecting";
    }
    return {
      ...actions,
      statusKey,
      statusTone: "neutral" as const,
    };
  }

  if (!state || state.verification === "unconfirmed") {
    return {
      ...actions,
      statusKey: connected ? "epic_status_unconfirmed" : "epic_status_unknown",
      statusTone: "warning" as const,
    };
  }

  let statusKey = "integration_status_not_connected";
  let statusTone: "neutral" | "warning" | "success" = "neutral";
  if (requiresReconnect) {
    statusKey = "epic_status_reconnect_required";
    statusTone = "warning";
  } else if (connected) {
    statusKey = "epic_status_connected";
    statusTone = "success";
  }
  return { ...actions, statusKey, statusTone };
};
