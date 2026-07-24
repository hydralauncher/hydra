import type {
  CloudSaveSyncProgressPayload,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
  RemoteSnapshotSummary,
  RestoreRemoteSnapshotResult,
} from "@types";

import {
  createRemoteSnapshotFromLocalState,
  type CreateRemoteSnapshotOptions,
} from "../create-remote-snapshot-from-local-state";
import { restoreRemoteSnapshot } from "../restore-remote-snapshot";

export type ProgressCallback = (progress: CloudSaveSyncProgressPayload) => void;

export const uploadLocalState = async (
  objectId: string,
  shop: GameShop,
  localSnapshotContext: LocalGameSnapshotContext,
  emitProgress: ProgressCallback,
  options: CreateRemoteSnapshotOptions = { baseVersion: 0 },
  assertEnvironmentCurrent?: () => Promise<void>
) => {
  emitProgress({
    gameId: { objectId, shop },
    stage: "uploading",
    processedFiles: 0,
    totalFiles: localSnapshotContext.files.length,
  });
  const snapshot = await createRemoteSnapshotFromLocalState(
    objectId,
    shop,
    (progress) =>
      emitProgress({
        gameId: { objectId, shop },
        stage: "uploading",
        processedFiles: progress.completedFiles,
        totalFiles: progress.totalFiles,
      }),
    localSnapshotContext,
    {
      ...options,
      assertEnvironmentCurrent,
    }
  );
  if (!snapshot) throw new Error("Local cloud save snapshot is empty");
  return snapshot;
};

export const restoreRemoteState = async (
  objectId: string,
  shop: GameShop,
  snapshot: RemoteSnapshotSummary | RemoteGameSnapshot,
  localSnapshotContext: LocalGameSnapshotContext,
  emitProgress: ProgressCallback,
  entryIds?: string[],
  updateAnchor = true,
  carriedUnresolvedEntryIds: string[] = [],
  assertEnvironmentCurrent?: () => Promise<void>
): Promise<RestoreRemoteSnapshotResult> => {
  emitProgress({
    gameId: { objectId, shop },
    stage: "restoring",
    processedFiles: 0,
    totalFiles: snapshot.fileCount,
  });
  const result = await restoreRemoteSnapshot(
    snapshot.id,
    { objectId, shop },
    (progress) =>
      emitProgress({
        gameId: { objectId, shop },
        stage: "restoring",
        processedFiles: progress.processedFiles,
        totalFiles: progress.totalFiles,
      }),
    snapshot,
    {
      environmentId: localSnapshotContext.environmentId,
      pathContext: localSnapshotContext.pathContext,
    },
    entryIds,
    updateAnchor,
    carriedUnresolvedEntryIds,
    0,
    assertEnvironmentCurrent
  );
  if (result.metadataFailedPaths > 0) {
    throw new Error("cloud_save_restore_metadata_failed");
  }
  if (!result.ok || result.failedFiles > 0) {
    throw new Error(
      `Cloud save restore failed for ${result.failedFiles} file(s)`
    );
  }
  return result;
};
