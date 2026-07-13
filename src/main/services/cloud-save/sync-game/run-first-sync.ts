import type {
  CloudSaveSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import type { analyzeCloudSaveState } from "../analyze-cloud-save-state";
import { saveCloudSaveSyncAnchor } from "../sync-anchor";
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

export const runFirstSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  analysis: CloudSaveAnalysis,
  emitProgress: ProgressCallback
): Promise<SyncOutcome> => {
  const initialState = "untracked";
  const hasLocalFiles = analysis.localSnapshot.files.length > 0;
  const remoteSnapshot = analysis.state.activeRemoteSnapshot;

  if (hasLocalFiles && remoteSnapshot) {
    if (analysis.localSnapshot.aggregateHash !== remoteSnapshot.aggregateHash) {
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

    await saveCloudSaveSyncAnchor(shop, objectId, {
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

  if (hasLocalFiles) {
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

  if (remoteSnapshot) {
    await restoreRemoteState(objectId, shop, remoteSnapshot, emitProgress);
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
