export interface EpicAccountData {
  epicAccountId: string;
  displayName: string;
}

export interface EpicConnectedConnection {
  connected: true;
  connectionId: string;
  epicAccountId: string;
  displayName: string;
  connectedAt: string;
  lastSyncedAt?: string | null;
  latestSyncRun?: EpicSyncRun | null;
  capabilities?: { achievementsSnapshotVersion?: 1 | null };
}

export type EpicConnection = { connected: false } | EpicConnectedConnection;

export type EpicSessionState = "ready" | "expired" | "missing" | "unavailable";

export type EpicErrorCode =
  | "hydra-auth-required"
  | "unsupported-platform"
  | "unsupported-architecture"
  | "legendary-missing"
  | "legendary-unavailable"
  | "api-unavailable"
  | "network"
  | "invalid-account-data"
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
  | "timeout"
  | "sync-active"
  | "snapshot-invalid"
  | "snapshot-too-large"
  | "source-permission"
  | "rate-limit"
  | "merge-failed"
  | "session-expired";

export interface EpicConnectionState {
  hydraLoggedIn: boolean;
  hydraUserId: string | null;
  availability: { available: boolean; reason?: EpicErrorCode };
  managedInstallation?: {
    available: boolean;
    reason?: import("./epic-managed.types").EpicInstallError;
  };
  connection: EpicConnection | null;
  /** Confirmation of the persisted Hydra link, independent of the local Epic session. */
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

export type EpicSyncTrigger = "FIRST_LINK" | "STARTUP" | "MANUAL";
export interface EpicSyncRun {
  id: string;
  trigger: EpicSyncTrigger;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  gamesCount: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  achievementSnapshotVersion?: 1 | null;
  achievementSummary?: EpicAchievementSummary | null;
}
export interface EpicAchievementSummary {
  status: "not-requested" | "complete" | "partial";
  gamesApplied: number;
  gamesPending: number;
  gamesUnsupported: number;
  unlocksApplied: number;
}
export interface EpicSnapshotAchievement {
  externalSetId: string;
  externalId: string;
  unlockTime: string;
}
export interface EpicAchievementTarget {
  objectId: string;
  status: "supported" | "unsupported" | "unavailable";
  achievementSandboxId?: string;
}
export type EpicSyncPhase =
  | "starting"
  | "library"
  | "playtime"
  | "achievements"
  | "publishing"
  | "merging"
  | "finishing";
export interface EpicSyncState {
  status: "idle" | "running" | "cancelling";
  hydraUserId: string | null;
  connectionId?: string;
  syncRunId?: string | null;
  phase?: EpicSyncPhase;
  processed?: number;
  total?: number | null;
  requiresReconnect?: boolean;
  error?: EpicErrorCode;
  achievementSummary?: EpicAchievementSummary;
}
export interface EpicSyncFinished {
  hydraUserId: string;
  connectionId: string;
  origin: "first-link" | "startup" | "manual";
  ok: boolean;
  error?: EpicErrorCode;
  publication: "not-published" | "published" | "unknown";
  requiresMerge: boolean;
  achievementSummary?: EpicAchievementSummary;
}
export interface EpicSnapshotGame {
  namespace: string;
  catalogItemId: string;
  artifactIds: string[];
  name: string;
  playTimeInSeconds: number;
  achievements?: EpicSnapshotAchievement[] | null;
}
