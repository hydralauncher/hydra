import type {
  CloudSaveOverview,
  CloudSaveState,
  CloudSaveSyncAction,
  CloudSaveSyncProgressPayload,
  CloudSaveSyncProgressStage,
  CloudSaveV2FileDetails,
  GameShop,
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

interface CloudSaveEmptySnapshotInput {
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  hasError: boolean;
}

export const shouldShowCloudSaveEmptySnapshot = ({
  overview,
}: CloudSaveEmptySnapshotInput) =>
  overview !== null && overview.activeRemoteSnapshot === null;

interface CloudSaveSnapshotPanelModeInput {
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  isSyncing: boolean;
  hasError: boolean;
}

export type CloudSaveSnapshotPanelMode = "content" | "skeleton" | "hidden";

export const getCloudSaveSnapshotPanelMode = ({
  overview,
  isLoading,
  isSyncing,
  hasError,
}: CloudSaveSnapshotPanelModeInput): CloudSaveSnapshotPanelMode => {
  if (overview !== null || isSyncing) return "content";
  if (isLoading && !hasError) return "skeleton";
  return "hidden";
};

export const canOpenCloudSaveFileBrowser = (
  overview: CloudSaveOverview | null
) => overview !== null;

export const hasCloudSaveDataToDelete = (
  details: CloudSaveV2FileDetails | null
) =>
  details !== null &&
  (details.activeSnapshot !== null ||
    details.local.fileCount > 0 ||
    details.customPaths.length > 0 ||
    details.unresolvedCustomPaths.some(({ registered }) => registered));

export type CloudSaveUploadLimitError = "snapshot-too-large" | "too-many-files";
export type CloudSaveSyncErrorKind =
  | CloudSaveUploadLimitError
  | "restore-metadata"
  | "generic";

const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
};

export const getCloudSaveUploadLimitError = (
  error: unknown
): CloudSaveUploadLimitError | null => {
  const message = getErrorMessage(error);

  if (message.includes("cloud_save_snapshot_too_large")) {
    return "snapshot-too-large";
  }
  if (message.includes("cloud_save_too_many_files")) {
    return "too-many-files";
  }
  return null;
};

export const getCloudSaveSyncErrorKind = (
  error: unknown
): CloudSaveSyncErrorKind => {
  const limitError = getCloudSaveUploadLimitError(error);
  if (limitError) return limitError;
  if (getErrorMessage(error).includes("cloud_save_restore_metadata_failed")) {
    return "restore-metadata";
  }
  return "generic";
};

export interface CloudSaveOperationPresentation {
  labelKey: string;
  fileCount: {
    count: number;
    processed: number;
    total: number;
  } | null;
}

export const getCloudSaveOperationPresentation = (
  progress: CloudSaveSyncProgressPayload | null,
  fallbackLabelKey = "cloud_save_v2_syncing"
): CloudSaveOperationPresentation => ({
  labelKey: progress
    ? `cloud_save_v2_progress_${progress.stage}`
    : fallbackLabelKey,
  fileCount:
    progress && progress.totalFiles > 0
      ? {
          count: progress.totalFiles,
          processed: progress.processedFiles,
          total: progress.totalFiles,
        }
      : null,
});

export const getCloudSavePartialDescriptionKey = (
  overview: CloudSaveOverview | null
) => {
  if (
    overview?.state !== "partial" ||
    overview.unconfiguredCustomPathCount > 0
  ) {
    return null;
  }
  if (overview.unresolvedRemoteVariantCount > 0) {
    return "cloud_save_v2_partial_unresolved_description";
  }
  if (overview.warnings.length > 0) {
    return "cloud_save_v2_partial_scan_description";
  }
  return "cloud_save_v2_partial_deferred_description";
};

interface GamePageOpenSyncInput {
  overview: CloudSaveOverview | null;
  shop: GameShop;
  canUseCloudSaves: boolean;
  hasExecutablePath: boolean;
  isGameRunning: boolean;
  isSyncing: boolean;
  isInFlight: boolean;
}

export const shouldSyncCloudSaveOnGamePage = ({
  overview,
  shop,
  canUseCloudSaves,
  hasExecutablePath,
  isGameRunning,
  isSyncing,
  isInFlight,
}: GamePageOpenSyncInput) =>
  shop === "steam" &&
  canUseCloudSaves &&
  hasExecutablePath &&
  !isGameRunning &&
  !isSyncing &&
  !isInFlight &&
  (overview?.unconfiguredCustomPathCount ?? 0) === 0 &&
  overview?.isAutomaticSyncEnabled === true;

interface CloudSavePresentationInput {
  canUseCloudSaves: boolean;
  hasExecutablePath: boolean;
  isChecking: boolean;
  isSyncing: boolean;
  hasError: boolean;
  hasUnconfiguredCustomPaths: boolean;
  state: CloudSaveState | null;
  progressStage: CloudSaveSyncProgressStage | null;
}

const getSyncProgressIcon = (
  progressStage: CloudSaveSyncProgressStage | null
): CloudSavePresentationIcon => {
  if (progressStage === "uploading") return "upload";
  if (progressStage === "restoring") return "restore";
  return "spinner";
};

export const getCloudSavePresentation = ({
  canUseCloudSaves,
  hasExecutablePath,
  isChecking,
  isSyncing,
  hasError,
  hasUnconfiguredCustomPaths,
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
    return {
      labelKey: "cloud_save_v2_syncing",
      icon: getSyncProgressIcon(progressStage),
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

  if (hasUnconfiguredCustomPaths) {
    return {
      labelKey: "cloud_save_v2_location_required",
      icon: "warning",
      tone: "outdated",
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
      kind: "confirm-location";
      labelKey: "cloud_save_v2_confirm_location";
      icon: "folder";
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
  suggestedAction: CloudSaveSyncAction | null,
  hasUnconfiguredCustomPaths = false
): CloudSavePanelAction => {
  if (hasUnconfiguredCustomPaths) {
    return {
      kind: "confirm-location",
      labelKey: "cloud_save_v2_confirm_location",
      icon: "folder",
    };
  }
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
  if (state === "synced" || state === "untracked") {
    return {
      kind: "verify",
      labelKey: "cloud_save_v2_check_again",
      icon: "refresh",
    };
  }
  return { kind: "none" };
};
