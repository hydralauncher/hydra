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
import { isGameRunning } from "../game-running-state";
import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { assertCloudSaveExecutableExists } from "./assert-cloud-save-executable";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { deleteLocalSaveTargets } from "./delete-local-save-targets";
import { assertCloudSaveEnvironmentCurrent } from "./environment-guard";
import { canDeleteInstallationOwnedCustomPathFiles } from "./installation-owned-custom-paths";
import { confirmCloudSaveCustomPaths } from "./custom-path-store";
import { resolveAnalyzedCloudSaveMerge } from "./resolve-analyzed-cloud-save-merge";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import { isCloudSaveSyncPartialAfterApply } from "./sync-result-policy";
import { shouldRetryCloudSaveConflict } from "./snapshot-retry-policy";
import { cloudSaveOperationGate } from "./operation-gate";
import { assertCloudSaveDeletionNotPending } from "./pending-deletion";
import {
  type ProgressCallback,
  getFirstSyncState,
  getSyncDirection,
  planCloudSaveSync,
  requireCommittedCloudSaveSnapshot,
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

const samePaths = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const getPostSyncState = (
  proposalChanged: boolean,
  partial: boolean
): CloudSaveState => {
  if (proposalChanged) return "local-ahead";
  return partial ? "partial" : "synced";
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

type AssertEnvironmentCurrent = () => Promise<void>;
type SyncFinisher = (
  action: SyncGameCloudSaveResult["action"],
  finalState: CloudSaveState,
  processedFiles?: number,
  totalFiles?: number,
  remoteHash?: string | null
) => SyncGameCloudSaveResult;

const createSyncFinisher = (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  analysis: CloudSaveAnalysis,
  emitProgress: ProgressCallback
): SyncFinisher => {
  const initialState = analysis.state.state;
  return (
    action,
    finalState,
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
};

const executeRestoreOnlySync = async ({
  objectId,
  shop,
  analysis,
  merge,
  proposalChanged,
  emitProgress,
  assertEnvironmentCurrent,
  finish,
}: {
  objectId: string;
  shop: GameShop;
  analysis: CloudSaveAnalysis;
  merge: CloudSaveMergeResult;
  proposalChanged: boolean;
  emitProgress: ProgressCallback;
  assertEnvironmentCurrent: AssertEnvironmentCurrent;
  finish: SyncFinisher;
}) => {
  const restoreIds = merge.restoreEntryIds;
  const deleteLocalIds = merge.deleteLocalEntryIds;
  const activeSnapshot = analysis.state.activeRemoteSnapshot;
  if ((restoreIds.length > 0 || deleteLocalIds.length > 0) && !activeSnapshot) {
    throw new Error("Active remote cloud save snapshot not found");
  }
  if (restoreIds.length === 0 && deleteLocalIds.length === 0) {
    return finish("none", getPostSyncState(proposalChanged, merge.partial));
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
    if (!restored) {
      emitProgress({
        gameId: { objectId, shop },
        stage: "restoring",
        processedFiles: 0,
        totalFiles: deleteLocalIds.length,
      });
    }
    await deleteLocalSaveTargets(
      analysis.localSnapshotContext,
      deleteLocalIds,
      assertEnvironmentCurrent
    );
  }
  const finalUnresolvedRemoteEntryIds =
    restored?.unresolvedRemoteEntryIds ?? merge.unresolvedRemoteEntryIds;
  await saveCurrentHeadAnchor(
    objectId,
    shop,
    analysis,
    finalUnresolvedRemoteEntryIds,
    assertEnvironmentCurrent
  );
  await confirmCloudSaveCustomPaths(
    shop,
    objectId,
    analysis.remoteManifest?.customPathRawPaths ?? []
  );
  const partial = isCloudSaveSyncPartialAfterApply({
    coverage: analysis.localSnapshotContext.coverage,
    unresolvedRemoteEntryIds: finalUnresolvedRemoteEntryIds,
    restorePartial: restored?.partial,
  });
  const processedFiles = restoreIds.length + deleteLocalIds.length;
  return finish(
    "restore",
    getPostSyncState(proposalChanged, partial),
    processedFiles,
    processedFiles
  );
};

const getAppliedSyncAction = (
  proposalChanged: boolean,
  appliedLocalChanges: boolean
): SyncGameCloudSaveResult["action"] => {
  if (proposalChanged) return appliedLocalChanges ? "merge" : "upload";
  return appliedLocalChanges ? "restore" : "none";
};

const saveAppliedSyncAnchor = async ({
  objectId,
  shop,
  analysis,
  merge,
  committedSnapshot,
  finalUnresolvedRemoteEntryIds,
  hasDeferredLocalChanges,
  proposalChanged,
  assertEnvironmentCurrent,
}: {
  objectId: string;
  shop: GameShop;
  analysis: CloudSaveAnalysis;
  merge: CloudSaveMergeResult;
  committedSnapshot: Awaited<ReturnType<typeof uploadLocalState>> | null;
  finalUnresolvedRemoteEntryIds: string[];
  hasDeferredLocalChanges: boolean;
  proposalChanged: boolean;
  assertEnvironmentCurrent: AssertEnvironmentCurrent;
}) => {
  if (hasDeferredLocalChanges) return;
  if (committedSnapshot) {
    await saveSnapshotAnchor(
      objectId,
      shop,
      analysis,
      committedSnapshot,
      merge.files,
      finalUnresolvedRemoteEntryIds,
      assertEnvironmentCurrent
    );
    return;
  }
  if (!proposalChanged) {
    await saveCurrentHeadAnchor(
      objectId,
      shop,
      analysis,
      finalUnresolvedRemoteEntryIds,
      assertEnvironmentCurrent
    );
  }
};

const executeAppliedSync = async ({
  objectId,
  shop,
  analysis,
  merge,
  mergedAggregateHash,
  mergedCustomPathRawPaths,
  proposalChanged,
  uploadOnly,
  plannedAction,
  emitProgress,
  assertEnvironmentCurrent,
  finish,
}: {
  objectId: string;
  shop: GameShop;
  analysis: CloudSaveAnalysis;
  merge: CloudSaveMergeResult;
  mergedAggregateHash: ReturnType<
    typeof NativeAddon.buildSnapshotAggregateHash
  >;
  mergedCustomPathRawPaths: string[];
  proposalChanged: boolean;
  uploadOnly: boolean;
  plannedAction: Extract<SyncGameCloudSaveResult["action"], "upload" | "merge">;
  emitProgress: ProgressCallback;
  assertEnvironmentCurrent: AssertEnvironmentCurrent;
  finish: SyncFinisher;
}) => {
  const restoreIds = merge.restoreEntryIds;
  const deleteLocalIds = merge.deleteLocalEntryIds;
  const activeSnapshot = analysis.state.activeRemoteSnapshot;
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
        customPathRawPaths: mergedCustomPathRawPaths,
        aggregateHash: mergedAggregateHash ?? undefined,
        unresolvedRemoteEntryIds: unresolved,
        updateAnchor: false,
      },
      assertEnvironmentCurrent
    );
    requireCommittedCloudSaveSnapshot(committedSnapshot);
  }

  let restoredPartial = false;
  let finalUnresolvedRemoteEntryIds = merge.unresolvedRemoteEntryIds;
  if (!uploadOnly && restoreIds.length > 0) {
    const snapshot = committedSnapshot ?? activeSnapshot;
    if (!snapshot) {
      throw new Error("Active remote cloud save snapshot not found");
    }
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
  await saveAppliedSyncAnchor({
    objectId,
    shop,
    analysis,
    merge,
    committedSnapshot,
    finalUnresolvedRemoteEntryIds,
    hasDeferredLocalChanges,
    proposalChanged,
    assertEnvironmentCurrent,
  });
  await confirmCloudSaveCustomPaths(
    shop,
    objectId,
    committedSnapshot
      ? mergedCustomPathRawPaths
      : (analysis.remoteManifest?.customPathRawPaths ?? [])
  );
  const partial = isCloudSaveSyncPartialAfterApply({
    coverage: analysis.localSnapshotContext.coverage,
    unresolvedRemoteEntryIds: finalUnresolvedRemoteEntryIds,
    restorePartial: restoredPartial,
    hasDeferredLocalChanges,
  });
  const appliedLocalChanges =
    !uploadOnly && (restoreIds.length > 0 || deleteLocalIds.length > 0);
  const action = proposalChanged
    ? plannedAction
    : getAppliedSyncAction(proposalChanged, appliedLocalChanges);
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

const executeGameCloudSaveSync = async ({
  objectId,
  shop,
  trigger,
  emitProgress,
  resolution,
  suppliedContext,
}: {
  objectId: string;
  shop: GameShop;
  trigger: CloudSaveSyncTrigger;
  emitProgress: ProgressCallback;
  resolution: CloudSaveConflictResolution | undefined;
  suppliedContext: Awaited<ReturnType<typeof getCloudSaveGameContext>>;
}): Promise<SyncGameCloudSaveResult> => {
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
    syncDirection,
    {
      allowInstallationOwnedCustomPathDeletion:
        canDeleteInstallationOwnedCustomPathFiles(trigger),
    }
  );
  await assertEnvironmentCurrent();
  const initialState = analysis.state.state;
  const merge = resolveAnalyzedCloudSaveMerge(analysis, resolution);
  const mergedAggregateHash = NativeAddon.buildSnapshotAggregateHash({
    variants: merge.variants,
    files: merge.files,
  });
  const finish = createSyncFinisher(
    objectId,
    shop,
    trigger,
    analysis,
    emitProgress
  );
  const proposalChanged =
    mergedAggregateHash !== analysis.activeRemoteSnapshot?.aggregateHash ||
    !samePaths(
      analysis.mergedCustomPathRawPaths,
      analysis.remoteManifest?.customPathRawPaths ?? []
    );
  const firstSyncState = getFirstSyncState(analysis);
  const syncPlan = planCloudSaveSync({
    trigger,
    initialState,
    firstSyncState,
    gameRunning: isGameRunning(objectId, shop),
    hasLocalFiles:
      analysis.localSnapshot.files.length > 0 ||
      analysis.localSnapshotContext.customPathRawPaths.length > 0,
    hasRemoteSnapshot: Boolean(analysis.activeRemoteSnapshot),
    hasConflicts: merge.conflicts.length > 0,
    proposalChanged,
    restoreEntryCount: merge.restoreEntryIds.length,
    deleteLocalEntryCount: merge.deleteLocalEntryIds.length,
  });

  if (syncPlan.kind === "blocked") {
    throw new Error("cloud_save_game_running");
  }
  if (syncPlan.kind === "conflict") {
    return finish("conflict", "conflict");
  }
  if (initialState === "untracked") {
    if (syncPlan.kind === "noop") {
      if (firstSyncState === "synced") {
        await saveCurrentHeadAnchor(
          objectId,
          shop,
          analysis,
          merge.unresolvedRemoteEntryIds,
          assertEnvironmentCurrent
        );
      }
      return finish("none", firstSyncState);
    }
    const outcome = await runFirstSync(
      objectId,
      shop,
      trigger,
      syncPlan.action,
      analysis,
      emitProgress,
      assertEnvironmentCurrent
    );
    if (outcome.result.action !== "conflict") {
      await confirmCloudSaveCustomPaths(
        shop,
        objectId,
        outcome.result.action === "upload"
          ? analysis.localSnapshotContext.customPathRawPaths
          : (analysis.remoteManifest?.customPathRawPaths ?? [])
      );
    }
    return finish(
      outcome.result.action,
      outcome.result.finalState,
      outcome.processedFiles,
      outcome.totalFiles
    );
  }

  const uploadOnly = syncDirection === "upload-only";
  const activeSnapshot = analysis.state.activeRemoteSnapshot;

  if (
    !activeSnapshot &&
    merge.files.length === 0 &&
    analysis.mergedCustomPathRawPaths.length === 0
  ) {
    return finish("none", "untracked");
  }

  if (syncPlan.execution === "none") {
    return finish("none", getPostSyncState(proposalChanged, merge.partial));
  }

  if (syncPlan.execution === "restore-only") {
    return executeRestoreOnlySync({
      objectId,
      shop,
      analysis,
      merge,
      proposalChanged,
      emitProgress,
      assertEnvironmentCurrent,
      finish,
    });
  }

  return executeAppliedSync({
    objectId,
    shop,
    analysis,
    merge,
    mergedAggregateHash,
    mergedCustomPathRawPaths: analysis.mergedCustomPathRawPaths,
    proposalChanged,
    uploadOnly,
    plannedAction: syncPlan.action,
    emitProgress,
    assertEnvironmentCurrent,
    finish,
  });
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
    return await executeGameCloudSaveSync({
      objectId,
      shop,
      trigger,
      emitProgress,
      resolution,
      suppliedContext,
    });
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
  const promise = cloudSaveOperationGate
    .runSync(
      key,
      operationKey,
      () => run(emitProgress),
      () => assertCloudSaveDeletionNotPending(objectId, shop)
    )
    .finally(() => {
      if (activeSyncs.get(key)?.promise === promise) activeSyncs.delete(key);
    });
  activeSyncs.set(key, { operationKey, promise, progress: progressState });
  return promise;
};

export const isCloudSaveSyncActive = (objectId: string, shop: GameShop) =>
  activeSyncs.has(gameKey(objectId, shop));

export const syncGameCloudSave = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger,
  onProgress?: ProgressCallback,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null
) => {
  assertCloudSaveSubscription();
  await assertCloudSaveExecutableExists(objectId, shop);
  if (isGameRunning(objectId, shop)) {
    throw new Error("cloud_save_game_running");
  }

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
    async (emitProgress) => {
      await assertCloudSaveExecutableExists(objectId, shop);
      if (isGameRunning(objectId, shop)) {
        throw new Error("cloud_save_game_running");
      }
      return runGameCloudSaveSync(
        objectId,
        shop,
        trigger,
        emitProgress,
        undefined,
        context
      );
    },
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
  await assertCloudSaveExecutableExists(objectId, shop);

  const context = await getCloudSaveGameContext(objectId, shop);
  return runCloudSaveOperation(
    objectId,
    shop,
    `resolve:${resolution}:${context.environmentId}`,
    async (emitProgress) => {
      await assertCloudSaveExecutableExists(objectId, shop);
      return runGameCloudSaveSync(
        objectId,
        shop,
        "manual",
        emitProgress,
        resolution,
        context
      );
    },
    onProgress
  );
};
