import type {
  CloudSaveConflictResolution,
  CloudSaveState,
  CloudSaveSyncProgressPayload,
  CloudSaveSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import {
  type ProgressCallback,
  getFirstSyncState,
  getSyncAction,
  hasRemoteChangedSinceBase,
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

const selectBaseRemoteHash = (
  expectedRemoteHash: string | null | undefined,
  anchorRemoteHash: string | undefined
) => {
  // `null` explicitly means the launch started without a remote snapshot.
  if (expectedRemoteHash === null) return null;
  return expectedRemoteHash ?? anchorRemoteHash;
};

type CloudSaveAnalysis = Awaited<ReturnType<typeof analyzeCloudSaveState>>;

interface ConflictResolutionInput {
  objectId: string;
  shop: GameShop;
  trigger: CloudSaveSyncTrigger;
  emitProgress: ProgressCallback;
  resolution: CloudSaveConflictResolution;
  analysis: CloudSaveAnalysis;
  initialState: CloudSaveState;
  effectiveState: CloudSaveState;
}

const runConflictResolution = async ({
  objectId,
  shop,
  trigger,
  emitProgress,
  resolution,
  analysis,
  initialState,
  effectiveState,
}: ConflictResolutionInput): Promise<SyncOutcome> => {
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
    return {
      result: {
        trigger,
        action: "upload",
        initialState,
        finalState: "synced",
      },
      processedFiles: analysis.localSnapshot.fileCount,
      totalFiles: analysis.localSnapshot.fileCount,
    };
  }

  const snapshot = analysis.state.activeRemoteSnapshot;
  if (!snapshot) {
    throw new Error("Active remote cloud save snapshot not found");
  }
  await restoreRemoteState(
    objectId,
    shop,
    snapshot,
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
    processedFiles: snapshot.fileCount,
    totalFiles: snapshot.fileCount,
  };
};

const runGameCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  emitProgress: ProgressCallback,
  resolution?: CloudSaveConflictResolution,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null
): Promise<SyncGameCloudSaveResult> => {
  emitProgress({
    gameId: { objectId, shop },
    stage: "analyzing",
    processedFiles: 0,
    totalFiles: 0,
  });
  const analysis = await analyzeCloudSaveState(objectId, shop, suppliedContext);
  const activeEnvironmentId = analysis.environmentId;
  const activeRemoteHash =
    analysis.state.activeRemoteSnapshot?.aggregateHash ?? null;
  const finish = ({ result, processedFiles, totalFiles }: SyncOutcome) => {
    emitProgress({
      gameId: { objectId, shop },
      stage: result.action === "conflict" ? "conflict" : "completed",
      processedFiles,
      totalFiles,
    });
    return {
      ...result,
      remoteHash: activeRemoteHash,
      environmentId: activeEnvironmentId,
    };
  };
  const initialState = analysis.state.state;
  const effectiveState =
    initialState === "untracked" ? getFirstSyncState(analysis) : initialState;

  if (resolution) {
    return finish(
      await runConflictResolution({
        objectId,
        shop,
        trigger,
        emitProgress,
        resolution,
        analysis,
        initialState,
        effectiveState,
      })
    );
  }

  const activeRemoteSnapshot = analysis.state.activeRemoteSnapshot;
  const baseRemoteHash = selectBaseRemoteHash(
    expectedRemoteHash,
    analysis.anchor?.baseAggregateHash
  );
  const remoteChangedSinceAnchor =
    trigger === "post-exit" &&
    hasRemoteChangedSinceBase(
      activeRemoteSnapshot?.aggregateHash ?? null,
      baseRemoteHash
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
    await restoreRemoteState(
      objectId,
      shop,
      snapshot,
      analysis.localSnapshotContext,
      emitProgress
    );
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

export const syncGameCloudSave = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  onProgress?: ProgressCallback,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null
) => {
  const context =
    suppliedContext ?? (await getCloudSaveGameContext(objectId, shop));
  const operationKey = JSON.stringify([
    "sync",
    trigger,
    context.environmentId,
    expectedRemoteHash === undefined
      ? ["anchor"]
      : ["expected", expectedRemoteHash],
  ]);

  return runCloudSaveOperation(
    objectId,
    shop,
    operationKey,
    (emitProgress) =>
      runGameCloudSaveSync(
        objectId,
        shop,
        trigger,
        emitProgress,
        undefined,
        context,
        expectedRemoteHash
      ),
    onProgress
  );
};

export const resolveCloudSaveConflict = async (
  objectId: string,
  shop: GameShop,
  resolution: CloudSaveConflictResolution,
  onProgress?: ProgressCallback
) => {
  const context = await getCloudSaveGameContext(objectId, shop);
  return runCloudSaveOperation(
    objectId,
    shop,
    `resolve:${resolution}:${context.environmentId}`,
    (emitProgress) =>
      runGameCloudSaveSync(
        objectId,
        shop,
        "manual",
        emitProgress,
        resolution,
        context
      ),
    onProgress
  );
};
