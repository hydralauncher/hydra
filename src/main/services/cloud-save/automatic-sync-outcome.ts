import type {
  CloudSaveAutomaticSyncTrigger,
  CloudSaveSyncProgressStage,
  SyncGameCloudSaveResult,
} from "@types";

export type AutomaticCloudSaveSyncOutcome =
  | { status: "completed"; result: SyncGameCloudSaveResult }
  | {
      status: "skipped" | "offline" | "cancelled" | "failed";
      result: null;
      errorCode?: string;
    };

export const getPendingDeletionAutomaticSyncOutcome = (
  deletionPending: boolean
): AutomaticCloudSaveSyncOutcome | null =>
  deletionPending
    ? {
        status: "cancelled",
        result: null,
        errorCode: "cloud_save_delete_pending",
      }
    : null;

export const classifyAutomaticCloudSaveFailure = (
  trigger: CloudSaveAutomaticSyncTrigger,
  latestStage?: CloudSaveSyncProgressStage
): "offline" | "failed" =>
  trigger === "pre-launch" && latestStage !== "restoring"
    ? "offline"
    : "failed";
