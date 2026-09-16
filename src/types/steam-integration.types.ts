export type SteamConnectErrorCode = "already-linked" | "generic";

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

export interface SteamSourceLibraryGame {
  steamAppId: string;
  name: string;
  playTimeInSeconds: number;
  lastPlayedAt: string | null;
}

export interface SteamSourceAchievement {
  name: string;
  unlocked: boolean;
  unlockTime: string | null;
}

export interface SteamSnapshotAchievement {
  name: string;
  unlockTime: string;
}

export interface SteamSnapshotGame {
  steamAppId: string;
  name: string;
  playTimeInSeconds: number;
  lastPlayedAt: string | null;
  achievements?: SteamSnapshotAchievement[];
}

export interface SteamSnapshotPayload {
  games: SteamSnapshotGame[];
}

export interface SteamGameSyncPayload {
  playTimeInSeconds: number;
  lastPlayedAt: string | null;
  achievements?: SteamSnapshotAchievement[];
}

export type SteamSyncOrigin = "manual" | "startup";

export type SteamSyncPhase =
  | "starting"
  | "library"
  | "achievements"
  | "publishing";

export type SteamSyncState =
  | { status: "idle" }
  | {
      status: "running";
      syncRunId: string;
      phase: SteamSyncPhase;
      gamesFound: number;
      gamesProcessed: number;
    }
  | { status: "cancelling"; syncRunId: string };

export type SteamSyncFinishedPayload =
  | {
      ok: true;
      status: SteamIntegrationStatus;
      origin: SteamSyncOrigin;
    }
  | { ok: false; message: string; origin: SteamSyncOrigin };
