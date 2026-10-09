import type { EpicConnectionState, EpicErrorCode } from "@types";

const EPIC_ERROR_TRANSLATIONS: Record<EpicErrorCode, string> = {
  "hydra-auth-required": "epic_error_hydra_auth",
  "unsupported-platform": "epic_error_platform",
  "unsupported-architecture": "epic_error_platform",
  "legendary-missing": "epic_error_legendary",
  "legendary-unavailable": "epic_error_legendary",
  "api-unavailable": "epic_error_api",
  network: "epic_error_network",
  "invalid-proof": "epic_error_proof",
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
};

export const getEpicErrorTranslation = (error: EpicErrorCode): string =>
  EPIC_ERROR_TRANSLATIONS[error] ?? "epic_error_auth";

export const isEpicStateForUser = (
  state: EpicConnectionState,
  hydraUserId: string | null
): boolean =>
  state.hydraUserId === hydraUserId ||
  (!state.hydraLoggedIn && state.hydraUserId === null);

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
    return {
      ...actions,
      statusKey:
        state.operation.status === "awaiting-login"
          ? "epic_status_awaiting_login"
          : state.operation.status === "disconnecting"
            ? "epic_status_disconnecting"
            : "epic_status_connecting",
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

  return {
    ...actions,
    statusKey: requiresReconnect
      ? "epic_status_reconnect_required"
      : connected
        ? "epic_status_connected"
        : "integration_status_not_connected",
    statusTone: requiresReconnect
      ? ("warning" as const)
      : connected
        ? ("success" as const)
        : ("neutral" as const),
  };
};
