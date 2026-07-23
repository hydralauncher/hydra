import type {
  CloudSaveState,
  CloudSaveSyncAction,
  CloudSaveSyncProgressStage,
} from "@types";

export type CloudSavePresentationTone =
  | "synced"
  | "outdated"
  | "conflict"
  | "neutral";

export type CloudSavePresentationIcon =
  | "cloud"
  | "cloud-slash"
  | "cloud-x"
  | "spinner"
  | "upload"
  | "restore"
  | "synced"
  | "warning";

export interface CloudSavePresentation {
  labelKey: string;
  icon: CloudSavePresentationIcon;
  tone: CloudSavePresentationTone;
}

interface CloudSavePresentationInput {
  canUseCloudSaves: boolean;
  hasExecutablePath: boolean;
  isChecking: boolean;
  isSyncing: boolean;
  hasError: boolean;
  state: CloudSaveState | null;
  progressStage: CloudSaveSyncProgressStage | null;
}

export const getCloudSavePresentation = ({
  canUseCloudSaves,
  hasExecutablePath,
  isChecking,
  isSyncing,
  hasError,
  state,
  progressStage,
}: CloudSavePresentationInput): CloudSavePresentation => {
  if (!canUseCloudSaves || !hasExecutablePath) {
    return {
      labelKey: "cloud_save",
      icon: "cloud-slash",
      tone: "neutral",
    };
  }

  if (isSyncing) {
    const icon =
      progressStage === "uploading"
        ? "upload"
        : progressStage === "restoring"
          ? "restore"
          : "spinner";
    return {
      labelKey: "cloud_save_v2_syncing",
      icon,
      tone: "neutral",
    };
  }

  if (isChecking || (!state && !hasError)) {
    return {
      labelKey: "cloud_save_v2_checking",
      icon: "spinner",
      tone: "neutral",
    };
  }

  if (hasError) {
    return {
      labelKey: "cloud_save_v2_unavailable",
      icon: "cloud-x",
      tone: "neutral",
    };
  }

  switch (state) {
    case "conflict":
      return {
        labelKey: "cloud_save_v2_conflict",
        icon: "warning",
        tone: "conflict",
      };
    case "partial":
      return {
        labelKey: "cloud_save_v2_partial",
        icon: "warning",
        tone: "outdated",
      };
    case "local-ahead":
    case "remote-ahead":
      return {
        labelKey: "cloud_save_v2_outdated",
        icon: "warning",
        tone: "outdated",
      };
    case "synced":
      return {
        labelKey: "cloud_save_v2_synced",
        icon: "synced",
        tone: "synced",
      };
    case "untracked":
    default:
      return {
        labelKey: "cloud_save",
        icon: "cloud",
        tone: "neutral",
      };
  }
};

export type CloudSavePanelAction =
  | {
      kind: "sync";
      labelKey: string;
      icon: "cloud" | "upload" | "restore";
    }
  | {
      kind: "details";
      labelKey: "cloud_save_v2_view_files";
      icon: "details";
    }
  | {
      kind: "verify";
      labelKey: "cloud_save_v2_check_again";
      icon: "refresh";
    }
  | { kind: "conflict" }
  | { kind: "none" };

export const getCloudSavePanelAction = (
  state: CloudSaveState | null,
  suggestedAction: CloudSaveSyncAction | null
): CloudSavePanelAction => {
  if (state === "conflict" || suggestedAction === "conflict") {
    return { kind: "conflict" };
  }
  if (state === "partial") {
    return {
      kind: "details",
      labelKey: "cloud_save_v2_view_files",
      icon: "details",
    };
  }
  if (suggestedAction === "merge") {
    return {
      kind: "sync",
      labelKey: "cloud_save_v2_sync_now",
      icon: "cloud",
    };
  }
  if (suggestedAction === "upload") {
    return {
      kind: "sync",
      labelKey: "cloud_save_v2_sync_to_remote",
      icon: "upload",
    };
  }
  if (suggestedAction === "restore") {
    return {
      kind: "sync",
      labelKey: "cloud_save_v2_sync_from_remote",
      icon: "restore",
    };
  }
  if (state === "synced") {
    return {
      kind: "verify",
      labelKey: "cloud_save_v2_check_again",
      icon: "refresh",
    };
  }
  return { kind: "none" };
};
