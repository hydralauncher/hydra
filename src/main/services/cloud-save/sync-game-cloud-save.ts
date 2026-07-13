import type {
  CloudSaveSyncProgressPayload,
  CloudSaveSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import {
  type ProgressCallback,
  restoreRemoteState,
  runFirstSync,
  type SyncOutcome,
  uploadLocalState,
} from "./sync-game";

interface ActiveSync {
  promise: Promise<SyncGameCloudSaveResult>;
  progress: ActiveSyncProgress;
}

interface ActiveSyncProgress {
  listeners: Set<ProgressCallback>;
  latestProgress?: CloudSaveSyncProgressPayload;
}

const activeSyncs = new Map<string, ActiveSync>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

const runGameCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  emitProgress: ProgressCallback
): Promise<SyncGameCloudSaveResult> => {
  const finish = ({ result, processedFiles, totalFiles }: SyncOutcome) => {
    emitProgress({
      gameId: { objectId, shop },
      stage: result.action === "conflict" ? "conflict" : "completed",
      processedFiles,
      totalFiles,
    });
    return result;
  };

  emitProgress({
    gameId: { objectId, shop },
    stage: "analyzing",
    processedFiles: 0,
    totalFiles: 0,
  });
  const analysis = await analyzeCloudSaveState(objectId, shop);
  const initialState = analysis.state.state;

  if (initialState === "untracked") {
    return finish(
      await runFirstSync(objectId, shop, trigger, analysis, emitProgress)
    );
  }

  if (initialState === "local-ahead") {
    await uploadLocalState(
      objectId,
      shop,
      analysis.localSnapshotContext,
      emitProgress
    );
    return finish({
      result: { trigger, action: "upload", initialState, finalState: "synced" },
      processedFiles: analysis.localSnapshot.fileCount,
      totalFiles: analysis.localSnapshot.fileCount,
    });
  }

  if (initialState === "remote-ahead") {
    const snapshot = analysis.state.activeRemoteSnapshot;
    if (!snapshot) {
      throw new Error("Active remote cloud save snapshot not found");
    }
    await restoreRemoteState(objectId, shop, snapshot, emitProgress);
    return finish({
      result: {
        trigger,
        action: "restore",
        initialState,
        finalState: "synced",
      },
      processedFiles: snapshot.fileCount,
      totalFiles: snapshot.fileCount,
    });
  }

  if (initialState === "conflict") {
    return finish({
      result: {
        trigger,
        action: "conflict",
        initialState,
        finalState: "conflict",
      },
      processedFiles: 0,
      totalFiles: 0,
    });
  }

  return finish({
    result: { trigger, action: "none", initialState, finalState: initialState },
    processedFiles: 0,
    totalFiles: 0,
  });
};

export const syncGameCloudSave = (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  onProgress?: ProgressCallback
): Promise<SyncGameCloudSaveResult> => {
  const key = gameKey(objectId, shop);
  const activeSync = activeSyncs.get(key);
  if (activeSync) {
    if (onProgress) {
      activeSync.progress.listeners.add(onProgress);
      if (activeSync.progress.latestProgress) {
        onProgress(activeSync.progress.latestProgress);
      }
    }
    return activeSync.promise;
  }

  const listeners = new Set<ProgressCallback>();
  if (onProgress) listeners.add(onProgress);
  const progressState: ActiveSyncProgress = { listeners };
  const emitProgress = (progress: CloudSaveSyncProgressPayload) => {
    progressState.latestProgress = progress;
    for (const listener of progressState.listeners) listener(progress);
  };

  const promise = runGameCloudSaveSync(
    objectId,
    shop,
    trigger,
    emitProgress
  ).finally(() => {
    if (activeSyncs.get(key)?.promise === promise) activeSyncs.delete(key);
  });
  const active: ActiveSync = { promise, progress: progressState };
  activeSyncs.set(key, active);
  return promise;
};
