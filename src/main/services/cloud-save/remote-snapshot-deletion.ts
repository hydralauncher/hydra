import type {
  CloudSaveConflictResolution,
  CloudSaveCustomPathBindings,
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import { getDeletableGameCloudSaveSourceFiles } from "./delete-game-cloud-save-targets.js";

export interface RemoteSnapshotDeletionPlan {
  automaticEntryIds: string[];
  unchangedAutomaticEntryIds: string[];
  conflictingAutomaticEntryIds: string[];
}

export type RemoteSnapshotDeletionDecision =
  | { kind: "conflict" }
  | { kind: "accept"; deleteLocalEntryIds: string[] }
  | { kind: "upload"; uploadEntryIds: string[] };

const sameBytes = (
  left: { hash: string; sizeBytes: number },
  right: { hash: string; sizeBytes: number }
) => left.hash === right.hash && left.sizeBytes === right.sizeBytes;

export const buildRemoteSnapshotDeletionPlan = (
  context: LocalGameSnapshotContext,
  anchor: CloudSaveSyncAnchor,
  customPathBindings: CloudSaveCustomPathBindings
): RemoteSnapshotDeletionPlan => {
  const automaticSourceFiles = getDeletableGameCloudSaveSourceFiles(
    context.sourceFiles,
    customPathBindings,
    context.pathContext.platform
  );
  const automaticEntryIds = [
    ...new Set(automaticSourceFiles.map(cloudSaveFileKey)),
  ].sort((left, right) => left.localeCompare(right));
  const localById = new Map(
    context.files.map((file) => [cloudSaveFileKey(file), file])
  );
  const baseById = new Map(
    anchor.entries.map((entry) => [cloudSaveFileKey(entry), entry])
  );
  const unchangedAutomaticEntryIds: string[] = [];
  const conflictingAutomaticEntryIds: string[] = [];

  for (const entryId of automaticEntryIds) {
    const localFile = localById.get(entryId);
    if (!localFile) {
      throw new Error("cloud_save_delete_local_target_missing");
    }
    const baseFile = baseById.get(entryId);
    if (baseFile && sameBytes(localFile, baseFile)) {
      unchangedAutomaticEntryIds.push(entryId);
    } else {
      conflictingAutomaticEntryIds.push(entryId);
    }
  }

  return {
    automaticEntryIds,
    unchangedAutomaticEntryIds,
    conflictingAutomaticEntryIds,
  };
};

export const decideRemoteSnapshotDeletion = (
  plan: RemoteSnapshotDeletionPlan,
  resolution?: CloudSaveConflictResolution
): RemoteSnapshotDeletionDecision => {
  const hasConflicts = plan.conflictingAutomaticEntryIds.length > 0;
  if (hasConflicts && !resolution) return { kind: "conflict" };
  if (!hasConflicts && resolution) {
    throw new Error("cloud_save_conflict_no_longer_exists");
  }
  if (resolution === "keep-local") {
    return { kind: "upload", uploadEntryIds: plan.automaticEntryIds };
  }
  return {
    kind: "accept",
    deleteLocalEntryIds:
      resolution === "keep-remote"
        ? plan.automaticEntryIds
        : plan.unchangedAutomaticEntryIds,
  };
};
