import type {
  CloudSaveConflictResolution,
  CloudSaveSyncProgressPayload,
  CloudSaveSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import {
  type ProgressCallback,
  getFirstSyncState,
  getSyncAction,
  restoreRemoteState,
  runFirstSync,
  type SyncOutcome,
  uploadLocalState,
} from "./sync-game";

interface ActiveSync {
  operationKey: string;
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
  emitProgress: ProgressCallback,
  resolution?: CloudSaveConflictResolution
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

  if (analysis.status === "local-conflict") {
    return finish({
      result: {
        trigger,
        action: "conflict",
        initialState: "local-conflict",
        finalState: "local-conflict",
      },
      processedFiles: 0,
      totalFiles: 0,
    });
  }

  const effectiveState =
    initialState === "untracked" ? getFirstSyncState(analysis) : initialState;

  if (resolution) {
    if (effectiveState !== "conflict") {
      throw new Error("cloud_save_conflict_no_longer_exists");
    }

    if (resolution === "keep-local") {
      await uploadLocalState(
        objectId,
        shop,
        analysis.localSnapshotContext,
        emitProgress
      );
      return finish({
        result: {
          trigger,
          action: "upload",
          initialState,
          finalState: "synced",
        },
        processedFiles: analysis.localSnapshot.fileCount,
        totalFiles: analysis.localSnapshot.fileCount,
      });
    }

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

  const activeRemoteSnapshot = analysis.state.activeRemoteSnapshot;
  const remoteChangedSinceAnchor = Boolean(
    trigger === "post-exit" &&
      analysis.anchor &&
      activeRemoteSnapshot?.aggregateHash !== analysis.anchor.baseAggregateHash
  );
  const action = getSyncAction(trigger, initialState, remoteChangedSinceAnchor);

  if (initialState === "untracked" && action !== "conflict") {
    return finish(
      await runFirstSync(objectId, shop, trigger, analysis, emitProgress)
    );
  }

  if (action === "upload") {
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

  if (action === "restore") {
    const snapshot = activeRemoteSnapshot;
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

  if (action === "conflict") {
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

const runCloudSaveOperation = (
  objectId: string,
  shop: GameShop,
  operationKey: string,
  run: (emitProgress: ProgressCallback) => Promise<SyncGameCloudSaveResult>,
  onProgress?: ProgressCallback
): Promise<SyncGameCloudSaveResult> => {
  const key = gameKey(objectId, shop);
  const activeSync = activeSyncs.get(key);
  if (activeSync) {
    if (activeSync.operationKey === operationKey && onProgress) {
      activeSync.progress.listeners.add(onProgress);
      if (activeSync.progress.latestProgress) {
        onProgress(activeSync.progress.latestProgress);
      }
    }
    if (activeSync.operationKey === operationKey) return activeSync.promise;

    return activeSync.promise.then(
      () =>
        runCloudSaveOperation(objectId, shop, operationKey, run, onProgress),
      () => runCloudSaveOperation(objectId, shop, operationKey, run, onProgress)
    );
  }

  const listeners = new Set<ProgressCallback>();
  if (onProgress) listeners.add(onProgress);
  const progressState: ActiveSyncProgress = { listeners };
  const emitProgress = (progress: CloudSaveSyncProgressPayload) => {
    progressState.latestProgress = progress;
    for (const listener of progressState.listeners) listener(progress);
  };

  const promise = run(emitProgress).finally(() => {
    if (activeSyncs.get(key)?.promise === promise) activeSyncs.delete(key);
  });
  const active: ActiveSync = { operationKey, promise, progress: progressState };
  activeSyncs.set(key, active);
  return promise;
};

export const syncGameCloudSave = (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  onProgress?: ProgressCallback
) =>
  runCloudSaveOperation(
    objectId,
    shop,
    "sync",
    (emitProgress) =>
      runGameCloudSaveSync(objectId, shop, trigger, emitProgress),
    onProgress
  );

export const resolveCloudSaveConflict = (
  objectId: string,
  shop: GameShop,
  resolution: CloudSaveConflictResolution,
  onProgress?: ProgressCallback
) =>
  runCloudSaveOperation(
    objectId,
    shop,
    `resolve:${resolution}`,
    (emitProgress) =>
      runGameCloudSaveSync(objectId, shop, "manual", emitProgress, resolution),
    onProgress
  );
