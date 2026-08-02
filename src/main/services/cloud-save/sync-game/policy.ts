import type {
  CloudSaveState,
  CloudSaveSyncAction,
  CloudSaveSyncTrigger,
} from "@types";

export type SyncDirection = "bidirectional" | "restore-only" | "upload-only";

export const hasRemoteChangedSinceBase = (
  currentRemoteHash: string | null,
  baseRemoteHash: string | null | undefined
) => baseRemoteHash !== undefined && currentRemoteHash !== baseRemoteHash;

export const getSyncDirection = (
  trigger: CloudSaveSyncTrigger
): SyncDirection => {
  if (trigger === "pre-launch" || trigger === "custom-path-rebind") {
    return "restore-only";
  }
  if (trigger === "post-exit") return "upload-only";
  return "bidirectional";
};

export const getSuggestedCloudSaveAction = (
  state: CloudSaveState,
  restoreEntryCount: number
): CloudSaveSyncAction => {
  if (state === "conflict") return "conflict";
  if (state === "local-ahead") {
    return restoreEntryCount > 0 ? "merge" : "upload";
  }
  if (state === "remote-ahead") return "restore";
  return "none";
};
