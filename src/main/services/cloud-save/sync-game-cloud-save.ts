import type {
  CloudSaveConflictResolution,
  CloudSaveMergeResult,
  CloudSaveState,
  CloudSaveSyncProgressPayload,
  CloudSaveSyncTrigger,
  GameShop,
  RemoteGameSnapshot,
  SnapshotFile,
  SyncGameCloudSaveResult,
} from "@types";

import { NativeAddon } from "../native-addon";
import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { deleteLocalSaveTargets } from "./delete-local-save-targets";
import { assertCloudSaveEnvironmentCurrent } from "./environment-guard";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import { shouldRetryCloudSaveConflict } from "./snapshot-retry-policy";
import {
  type ProgressCallback,
  getSyncDirection,
  runFirstSync,
  restoreRemoteState,
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
type CloudSaveAnalysis = Awaited<ReturnType<typeof analyzeCloudSaveState>>;

const resolvedMerge = (
  analysis: CloudSaveAnalysis,
  resolution?: CloudSaveConflictResolution
): CloudSaveMergeResult => {
  if (!resolution) return analysis.merge;
  if (analysis.merge.conflicts.length === 0) {
    throw new Error("cloud_save_conflict_no_longer_exists");
  }
  const resolutions = new Map(
    analysis.merge.conflicts.map((conflict) => [conflict.entryId, resolution])
  );
  return mergeUserVariantSnapshots({
    local: analysis.localSnapshotContext,
    remoteVariants: analysis.remoteManifest?.variants ?? [],
    remoteFiles: analysis.remoteManifest?.files ?? [],
    base: analysis.anchor,
    direction: analysis.syncDirection,
    resolutions,
  });
};

const saveCurrentHeadAnchor = async (
  objectId: string,
  shop: GameShop,
  analysis: CloudSaveAnalysis,
  unresolvedRemoteEntryIds: string[],
  assertEnvironmentCurrent?: () => Promise<void>
) => {
  if (!analysis.activeRemoteSnapshot || !analysis.remoteManifest) return;
  await assertEnvironmentCurrent?.();
  await saveCloudSaveSyncAnchor(shop, objectId, analysis.environmentId, {
    schemaVersion: 4,
    environmentId: analysis.environmentId,
    baseSnapshotId: analysis.activeRemoteSnapshot.id,
    baseVersion: analysis.activeRemoteSnapshot.version,
    baseAggregateHash: analysis.activeRemoteSnapshot.aggregateHash,
    entries: analysis.remoteManifest.files.map((file) => ({
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
    })),
    unresolvedRemoteEntryIds,
    updatedAt: new Date().toISOString(),
  });
};

const saveSnapshotAnchor = async (
  objectId: string,
  shop: GameShop,
  analysis: CloudSaveAnalysis,
  snapshot: RemoteGameSnapshot,
  files: SnapshotFile[],
  unresolvedRemoteEntryIds: string[],
  assertEnvironmentCurrent?: () => Promise<void>
) => {
  await assertEnvironmentCurrent?.();
  const fileIds = new Set(files.map(cloudSaveFileKey));
  await saveCloudSaveSyncAnchor(shop, objectId, analysis.environmentId, {
    schemaVersion: 4,
    environmentId: analysis.environmentId,
    baseSnapshotId: snapshot.id,
    baseVersion: snapshot.version,
    baseAggregateHash: snapshot.aggregateHash,
    entries: files.map((file) => ({
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
    })),
    unresolvedRemoteEntryIds: unresolvedRemoteEntryIds.filter((entryId) =>
      fileIds.has(entryId)
    ),
    updatedAt: new Date().toISOString(),
  });
};

const executeGameCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  emitProgress: ProgressCallback,
  resolution: CloudSaveConflictResolution | undefined,
  suppliedContext: Awaited<ReturnType<typeof getCloudSaveGameContext>>
): Promise<SyncGameCloudSaveResult> => {
  const assertEnvironmentCurrent = () =>
    assertCloudSaveEnvironmentCurrent(
      objectId,
      shop,
      suppliedContext.environmentId
    ).then(() => undefined);
  await assertEnvironmentCurrent();
  emitProgress({
    gameId: { objectId, shop },
    stage: "analyzing",
    processedFiles: 0,
    totalFiles: 0,
  });
  const syncDirection = getSyncDirection(trigger);
  const analysis = await analyzeCloudSaveState(
    objectId,
    shop,
    suppliedContext,
    syncDirection
  );
  await assertEnvironmentCurrent();
  const initialState = analysis.state.state;
  const merge = resolvedMerge(analysis, resolution);
  const mergedAggregateHash =
    merge.files.length > 0
      ? NativeAddon.buildSnapshotAggregateHash({
          variants: merge.variants,
          files: merge.files,
        })
      : null;
  const finish = (
    action: SyncGameCloudSaveResult["action"],
    finalState: CloudSaveState,
    processedFiles = 0,
    totalFiles = 0,
    remoteHash = analysis.activeRemoteSnapshot?.aggregateHash ?? null
  ) => {
    emitProgress({
      gameId: { objectId, shop },
      stage: action === "conflict" ? "conflict" : "completed",
      processedFiles,
      totalFiles,
    });
    return {
      trigger,
      action,
      initialState,
      finalState,
      remoteHash,
      environmentId: analysis.environmentId,
    };
  };

  if (merge.conflicts.length > 0) {
    return finish("conflict", "conflict");
  }
  if (initialState === "untracked") {
    const outcome = await runFirstSync(
      objectId,
      shop,
      trigger,
      analysis,
      emitProgress,
      assertEnvironmentCurrent
    );
    return finish(
      outcome.result.action,
      outcome.result.finalState,
      outcome.processedFiles,
      outcome.totalFiles
    );
  }

  const proposalChanged =
    mergedAggregateHash !== analysis.activeRemoteSnapshot?.aggregateHash;
  const restoreIds = merge.restoreEntryIds;
  const restoreOnly = syncDirection === "restore-only";
  const uploadOnly = syncDirection === "upload-only";
  const activeSnapshot = analysis.state.activeRemoteSnapshot;
  const deleteLocalIds = merge.deleteLocalEntryIds;

  if (restoreOnly) {
    if (
      (restoreIds.length > 0 || deleteLocalIds.length > 0) &&
      !activeSnapshot
    ) {
      throw new Error("Active remote cloud save snapshot not found");
    }
    if (restoreIds.length === 0 && deleteLocalIds.length === 0) {
      return finish(
        "none",
        proposalChanged ? "local-ahead" : merge.partial ? "partial" : "synced"
      );
    }
    const restored =
      restoreIds.length > 0 && activeSnapshot
        ? await restoreRemoteState(
            objectId,
            shop,
            activeSnapshot,
            analysis.localSnapshotContext,
            emitProgress,
            restoreIds,
            false,
            merge.unresolvedRemoteEntryIds,
            assertEnvironmentCurrent
          )
        : null;
    if (deleteLocalIds.length > 0) {
      await deleteLocalSaveTargets(
        analysis.localSnapshotContext,
        deleteLocalIds,
        assertEnvironmentCurrent
      );
    }
    await saveCurrentHeadAnchor(
      objectId,
      shop,
      analysis,
      restored?.unresolvedRemoteEntryIds ?? merge.unresolvedRemoteEntryIds,
      assertEnvironmentCurrent
    );
    return finish(
      "restore",
      proposalChanged
        ? "local-ahead"
        : restored?.partial || merge.partial
          ? "partial"
          : "synced",
      restoreIds.length + deleteLocalIds.length,
      restoreIds.length + deleteLocalIds.length
    );
  }

  let committedSnapshot: Awaited<ReturnType<typeof uploadLocalState>> | null =
    null;
  if (proposalChanged) {
    const unresolved = uploadOnly
      ? [...new Set([...merge.unresolvedRemoteEntryIds, ...restoreIds])]
      : merge.unresolvedRemoteEntryIds;
    committedSnapshot = await uploadLocalState(
      objectId,
      shop,
      analysis.localSnapshotContext,
      emitProgress,
      {
        baseVersion: analysis.activeRemoteSnapshot?.version ?? 0,
        expectedSnapshotId: analysis.activeRemoteSnapshot?.id ?? null,
        variants: merge.variants,
        files: merge.files,
        aggregateHash: mergedAggregateHash ?? undefined,
        unresolvedRemoteEntryIds: unresolved,
        updateAnchor: false,
      },
      assertEnvironmentCurrent
    );
  }

  let restoredPartial = false;
  let finalUnresolvedRemoteEntryIds = merge.unresolvedRemoteEntryIds;
  if (!uploadOnly && restoreIds.length > 0) {
    const snapshot = committedSnapshot ?? activeSnapshot;
    if (!snapshot)
      throw new Error("Active remote cloud save snapshot not found");
    const restored = await restoreRemoteState(
      objectId,
      shop,
      snapshot,
      analysis.localSnapshotContext,
      emitProgress,
      restoreIds,
      false,
      merge.unresolvedRemoteEntryIds,
      assertEnvironmentCurrent
    );
    restoredPartial = restored.partial;
    finalUnresolvedRemoteEntryIds = restored.unresolvedRemoteEntryIds;
  }

  if (!uploadOnly && deleteLocalIds.length > 0) {
    await deleteLocalSaveTargets(
      analysis.localSnapshotContext,
      deleteLocalIds,
      assertEnvironmentCurrent
    );
  }

  const hasDeferredLocalChanges =
    uploadOnly && (restoreIds.length > 0 || deleteLocalIds.length > 0);
  if (!hasDeferredLocalChanges && committedSnapshot) {
    await saveSnapshotAnchor(
      objectId,
      shop,
      analysis,
      committedSnapshot,
      merge.files,
      finalUnresolvedRemoteEntryIds,
      assertEnvironmentCurrent
    );
  } else if (!hasDeferredLocalChanges && !proposalChanged) {
    await saveCurrentHeadAnchor(
      objectId,
      shop,
      analysis,
      finalUnresolvedRemoteEntryIds,
      assertEnvironmentCurrent
    );
  }
  const partial = merge.partial || restoredPartial || hasDeferredLocalChanges;
  const appliedLocalChanges =
    !uploadOnly && (restoreIds.length > 0 || deleteLocalIds.length > 0);
  const action = proposalChanged
    ? appliedLocalChanges
      ? "merge"
      : "upload"
    : appliedLocalChanges
      ? "restore"
      : "none";
  const processedFiles =
    (proposalChanged ? merge.files.length : 0) +
    (!uploadOnly ? restoreIds.length + deleteLocalIds.length : 0);
  return finish(
    action,
    partial ? "partial" : "synced",
    processedFiles,
    processedFiles,
    committedSnapshot?.aggregateHash ??
      analysis.activeRemoteSnapshot?.aggregateHash ??
      null
  );
};

const runGameCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  emitProgress: ProgressCallback,
  resolution: CloudSaveConflictResolution | undefined,
  suppliedContext: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  attempt = 0
): Promise<SyncGameCloudSaveResult> => {
  try {
    return await executeGameCloudSaveSync(
      objectId,
      shop,
      trigger,
      emitProgress,
      resolution,
      suppliedContext
    );
  } catch (error) {
    if (shouldRetryCloudSaveConflict(error, attempt)) {
      return runGameCloudSaveSync(
        objectId,
        shop,
        trigger,
        emitProgress,
        resolution,
        suppliedContext,
        1
      );
    }
    throw error;
  }
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
  activeSyncs.set(key, { operationKey, promise, progress: progressState });
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
  assertCloudSaveSubscription();

  const context =
    suppliedContext ?? (await getCloudSaveGameContext(objectId, shop));
  const operationKey = JSON.stringify([
    "sync",
    trigger,
    context.environmentId,
    expectedRemoteHash,
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
        context
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
  assertCloudSaveSubscription();

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
