export interface EpicConnectedConnection {
  connected: true;
  connectionId: string;
  epicAccountId: string;
  displayName: string;
  connectedAt: string;
}

export type EpicConnection = { connected: false } | EpicConnectedConnection;

export type EpicSessionState = "ready" | "expired" | "missing" | "unavailable";

export type EpicErrorCode =
  | "hydra-auth-required"
  | "unsupported-platform"
  | "unsupported-architecture"
  | "legendary-missing"
  | "legendary-unavailable"
  | "vault-unavailable"
  | "api-unavailable"
  | "network"
  | "invalid-proof"
  | "account-in-use"
  | "different-account"
  | "stale-connection"
  | "invalid-response"
  | "persistence-failed"
  | "cleanup-failed"
  | "oauth-client-mismatch"
  | "operation-cancelled"
  | "operation-in-progress"
  | "invalid-operation"
  | "auth-failed"
  | "timeout";

export interface EpicConnectionState {
  hydraLoggedIn: boolean;
  hydraUserId: string | null;
  availability: { available: boolean; reason?: EpicErrorCode };
  connection: EpicConnection | null;
  verification: "confirmed" | "unconfirmed";
  sessionState: EpicSessionState;
  operation: {
    id: string;
    status:
      | "awaiting-login"
      | "authenticating"
      | "connecting"
      | "disconnecting";
  } | null;
  error?: EpicErrorCode;
}

export type EpicOperationResult =
  | { ok: true }
  | { ok: false; error: EpicErrorCode };

export type EpicStartAuthResult =
  | { ok: true; operationId: string }
  | { ok: false; error: EpicErrorCode };
