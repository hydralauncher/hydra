export type SteamSyncRunTrigger = "FIRST_LINK" | "MANUAL";

export type SteamSyncRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface SteamSyncRun {
  id: string;
  trigger: SteamSyncRunTrigger;
  status: SteamSyncRunStatus;
  gamesFound: number;
  gamesUpserted: number;
  achievementsUnlocked: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface SteamIntegrationAccount {
  steamId64: string;
  username: string;
  avatarUrl: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  lastSyncedAt: string | null;
  latestSyncRun: SteamSyncRun | null;
}

export type SteamDisconnectedStatus = {
  connected: false;
  snapshotPreserved: false;
};

export type SteamConnectedStatus = SteamIntegrationAccount & {
  connected: true;
  snapshotPreserved: false;
};

export type SteamPreservedSnapshotStatus = SteamIntegrationAccount & {
  connected: false;
  snapshotPreserved: true;
};

export type SteamIntegrationStatus =
  | SteamDisconnectedStatus
  | SteamConnectedStatus
  | SteamPreservedSnapshotStatus;
