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

export const classifyAutomaticCloudSaveFailure = (
  trigger: CloudSaveAutomaticSyncTrigger,
  latestStage?: CloudSaveSyncProgressStage
): "offline" | "failed" =>
  trigger === "pre-launch" && latestStage !== "restoring"
    ? "offline"
    : "failed";
