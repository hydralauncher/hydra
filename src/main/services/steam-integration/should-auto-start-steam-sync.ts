export type SteamAutoStartRunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export const shouldAutoStartSteamSync = ({
  connected,
  lastSyncedAt,
  latestSyncRunStatus,
  localOrchestratorIdle,
}: {
  connected: boolean;
  lastSyncedAt: string | null;
  latestSyncRunStatus?: SteamAutoStartRunStatus | null;
  localOrchestratorIdle: boolean;
}): boolean => {
  if (!connected || !localOrchestratorIdle) {
    return false;
  }

  if (latestSyncRunStatus === "PENDING") {
    return true;
  }

  if (latestSyncRunStatus === "FAILED" || latestSyncRunStatus === "RUNNING") {
    return false;
  }

  return lastSyncedAt == null;
};
