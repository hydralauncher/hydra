import type {
  CloudSaveSyncAction,
  CloudSaveState,
  CloudSaveSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import type { analyzeCloudSaveState } from "../analyze-cloud-save-state";
import {
  type ProgressCallback,
  restoreRemoteState,
  uploadLocalState,
} from "./transfer";
import { requireCommittedCloudSaveSnapshot } from "./planner.js";

type CloudSaveAnalysis = Awaited<ReturnType<typeof analyzeCloudSaveState>>;

export interface SyncOutcome {
  result: SyncGameCloudSaveResult;
  processedFiles: number;
  totalFiles: number;
}

export const getFirstSyncState = (
  analysis: CloudSaveAnalysis
): CloudSaveState => {
  const hasLocalFiles = analysis.localSnapshot.files.length > 0;
  const remoteSnapshot = analysis.state.activeRemoteSnapshot;

  if (hasLocalFiles && remoteSnapshot) {
    return analysis.localSnapshot.aggregateHash === remoteSnapshot.aggregateHash
      ? "synced"
      : "conflict";
  }
  if (hasLocalFiles) return "local-ahead";
  if (remoteSnapshot) return "remote-ahead";
  return "untracked";
};

export const runFirstSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  plannedAction: CloudSaveSyncAction,
  analysis: CloudSaveAnalysis,
  emitProgress: ProgressCallback,
  assertEnvironmentCurrent?: () => Promise<void>
): Promise<SyncOutcome> => {
  const initialState = "untracked";
  const remoteSnapshot = analysis.state.activeRemoteSnapshot;
  const action = plannedAction;

  if (action === "conflict") {
    return {
      result: {
        trigger,
        action: "conflict",
        initialState,
        finalState: "conflict",
      },
      processedFiles: 0,
      totalFiles: 0,
    };
  }

  if (action === "upload") {
    const committedSnapshot = await uploadLocalState(
      objectId,
      shop,
      analysis.localSnapshotContext,
      emitProgress,
      {
        baseVersion: analysis.activeRemoteSnapshot?.version ?? 0,
        expectedSnapshotId: analysis.activeRemoteSnapshot?.id ?? null,
        variants: analysis.merge.variants,
        files: analysis.merge.files,
        aggregateHash: analysis.mergedAggregateHash ?? undefined,
        unresolvedRemoteEntryIds: analysis.merge.unresolvedRemoteEntryIds,
      },
      assertEnvironmentCurrent
    );
    requireCommittedCloudSaveSnapshot(committedSnapshot);
    return {
      result: {
        trigger,
        action: "upload",
        initialState,
        finalState: analysis.merge.partial ? "partial" : "synced",
      },
      processedFiles: analysis.localSnapshot.fileCount,
      totalFiles: analysis.localSnapshot.fileCount,
    };
  }

  if (action === "restore" && remoteSnapshot) {
    const restoreEntryIds = analysis.merge.restoreEntryIds;
    const restored = await restoreRemoteState(
      objectId,
      shop,
      remoteSnapshot,
      analysis.localSnapshotContext,
      emitProgress,
      restoreEntryIds,
      true,
      analysis.merge.unresolvedRemoteEntryIds,
      assertEnvironmentCurrent
    );
    return {
      result: {
        trigger,
        action: "restore",
        initialState,
        finalState: restored.partial ? "partial" : "synced",
      },
      processedFiles: restoreEntryIds.length,
      totalFiles: restoreEntryIds.length,
    };
  }

  return {
    result: { trigger, action: "none", initialState, finalState: initialState },
    processedFiles: 0,
    totalFiles: 0,
  };
};
