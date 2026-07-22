import type {
  CloudSaveState,
  CloudSaveSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import type { analyzeCloudSaveState } from "../analyze-cloud-save-state";
import { saveCloudSaveSyncAnchor } from "../sync-anchor";
import { getSyncAction } from "./policy";
import {
  type ProgressCallback,
  restoreRemoteState,
  uploadLocalState,
} from "./transfer";

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
  analysis: CloudSaveAnalysis,
  emitProgress: ProgressCallback
): Promise<SyncOutcome> => {
  const initialState = "untracked";
  const firstSyncState = getFirstSyncState(analysis);
  const remoteSnapshot = analysis.state.activeRemoteSnapshot;
  const action = getSyncAction(trigger, firstSyncState);

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

  if (firstSyncState === "synced" && remoteSnapshot) {
    await saveCloudSaveSyncAnchor(shop, objectId, analysis.environmentId, {
      baseSnapshotId: remoteSnapshot.id,
      baseAggregateHash: remoteSnapshot.aggregateHash,
      updatedAt: new Date().toISOString(),
    });
    return {
      result: { trigger, action: "none", initialState, finalState: "synced" },
      processedFiles: 0,
      totalFiles: 0,
    };
  }

  if (action === "upload") {
    await uploadLocalState(
      objectId,
      shop,
      analysis.localSnapshotContext,
      emitProgress
    );
    return {
      result: { trigger, action: "upload", initialState, finalState: "synced" },
      processedFiles: analysis.localSnapshot.fileCount,
      totalFiles: analysis.localSnapshot.fileCount,
    };
  }

  if (action === "restore" && remoteSnapshot) {
    await restoreRemoteState(
      objectId,
      shop,
      remoteSnapshot,
      analysis.localSnapshotContext,
      emitProgress
    );
    return {
      result: {
        trigger,
        action: "restore",
        initialState,
        finalState: "synced",
      },
      processedFiles: remoteSnapshot.fileCount,
      totalFiles: remoteSnapshot.fileCount,
    };
  }

  return {
    result: { trigger, action: "none", initialState, finalState: initialState },
    processedFiles: 0,
    totalFiles: 0,
  };
};
