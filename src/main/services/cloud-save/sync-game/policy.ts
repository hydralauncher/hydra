import type {
  CloudSaveState,
  CloudSaveSyncAction,
  CloudSaveSyncTrigger,
} from "@types";

type SyncDirection = "bidirectional" | "restore-only" | "upload-only";

export const hasRemoteChangedSinceBase = (
  currentRemoteHash: string | null,
  baseRemoteHash: string | null | undefined
) => baseRemoteHash !== undefined && currentRemoteHash !== baseRemoteHash;

const getSyncDirection = (trigger: CloudSaveSyncTrigger): SyncDirection => {
  if (trigger === "pre-launch" || trigger === "environment-changed") {
    return "restore-only";
  }
  if (trigger === "post-exit") return "upload-only";
  return "bidirectional";
};

export const getSyncAction = (
  trigger: CloudSaveSyncTrigger,
  state: CloudSaveState,
  remoteChangedSinceAnchor = false
): CloudSaveSyncAction => {
  if (state === "conflict") return "conflict";

  const direction = getSyncDirection(trigger);

  if (direction === "upload-only" && remoteChangedSinceAnchor) {
    return "conflict";
  }

  if (
    state === "local-ahead" &&
    (direction === "bidirectional" || direction === "upload-only")
  ) {
    return "upload";
  }

  if (
    state === "remote-ahead" &&
    (direction === "bidirectional" || direction === "restore-only")
  ) {
    return "restore";
  }

  return "none";
};
