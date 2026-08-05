import type {
  CloudSaveState,
  CloudSaveSyncAction,
  CloudSaveSyncTrigger,
} from "@types";

import { getSyncDirection } from "./policy.js";

export type CloudSaveSyncPlan =
  | { kind: "noop"; action: "none"; execution: "none" }
  | { kind: "restore"; action: "restore"; execution: "restore-only" }
  | { kind: "upload"; action: "upload"; execution: "apply" }
  | { kind: "merge"; action: "merge"; execution: "apply" }
  | { kind: "conflict"; action: "conflict"; execution: "none" }
  | {
      kind: "blocked";
      action: "none";
      execution: "none";
      reason: "game-running";
    };

interface PlanCloudSaveSyncInput {
  trigger: CloudSaveSyncTrigger;
  initialState: CloudSaveState;
  firstSyncState: CloudSaveState;
  gameRunning: boolean;
  hasLocalFiles: boolean;
  hasRemoteSnapshot: boolean;
  hasConflicts: boolean;
  proposalChanged: boolean;
  restoreEntryCount: number;
  deleteLocalEntryCount: number;
}

const plan = (
  kind: Exclude<CloudSaveSyncPlan["kind"], "blocked">
): CloudSaveSyncPlan => {
  const action: CloudSaveSyncAction = kind === "noop" ? "none" : kind;
  let execution: CloudSaveSyncPlan["execution"] = "none";

  if (kind === "restore") {
    execution = "restore-only";
  } else if (kind === "upload" || kind === "merge") {
    execution = "apply";
  }

  return {
    kind,
    action,
    execution,
  } as CloudSaveSyncPlan;
};

export const planCloudSaveSync = ({
  trigger,
  initialState,
  firstSyncState,
  gameRunning,
  hasLocalFiles,
  hasRemoteSnapshot,
  hasConflicts,
  proposalChanged,
  restoreEntryCount,
  deleteLocalEntryCount,
}: PlanCloudSaveSyncInput): CloudSaveSyncPlan => {
  const direction = getSyncDirection(trigger);
  if (gameRunning) {
    return {
      kind: "blocked",
      action: "none",
      execution: "none",
      reason: "game-running",
    };
  }

  const hasLocalChangesToApply =
    restoreEntryCount > 0 || deleteLocalEntryCount > 0;
  const emptyLocalRequiresRemotePreservation =
    !hasLocalFiles && hasRemoteSnapshot;

  if (emptyLocalRequiresRemotePreservation) {
    return hasLocalChangesToApply ? plan("restore") : plan("noop");
  }

  if (hasConflicts) return plan("conflict");

  if (initialState === "untracked") {
    if (firstSyncState === "conflict") return plan("conflict");
    if (firstSyncState === "remote-ahead") return plan("restore");
    if (firstSyncState === "local-ahead" && direction !== "restore-only") {
      return plan("upload");
    }
    return plan("noop");
  }

  if (direction === "restore-only") {
    return hasLocalChangesToApply ? plan("restore") : plan("noop");
  }

  if (proposalChanged) {
    return direction !== "upload-only" && hasLocalChangesToApply
      ? plan("merge")
      : plan("upload");
  }

  if (direction !== "upload-only" && hasLocalChangesToApply) {
    return plan("restore");
  }

  return plan("noop");
};

export const requireCommittedCloudSaveSnapshot = <T>(snapshot: T | null): T => {
  if (!snapshot) throw new Error("cloud_save_snapshot_not_committed");
  return snapshot;
};
